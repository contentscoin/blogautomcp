'use client';

import { useEffect, useMemo, useState } from 'react';

type Release = {
  version: string;
  installerName: string;
  installerSize: number;
  publishedAt: string;
};

type ParsedManifest = {
  version: string;
  installerName: string;
  sha512: string;
  size: number;
};

const endpoint = '/api/admin/updates/windows';
const partSize = 20 * 1024 * 1024;

async function api<T>(responseInput: Response | Promise<Response>): Promise<T> {
  const response = await responseInput;
  const payload: unknown = await response.json().catch(() => null);
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const error = value?.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : null;
  if (!response.ok || value?.success !== true) {
    throw new Error(typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`);
  }
  return value.data as T;
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed) as string;
  return trimmed;
}

function matchValue(manifest: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(manifest);
  if (!match?.[1]) throw new Error(`latest.yml의 ${label} 값을 찾지 못했습니다.`);
  return scalar(match[1]);
}

function parseManifest(manifest: string): ParsedManifest {
  const version = matchValue(manifest, /^version:\s*(.+)$/m, 'version');
  const rawUrl = matchValue(manifest, /^\s*-\s+url:\s*(.+)$/m, 'files.url');
  const installerName = decodeURIComponent(rawUrl);
  const sha512 = matchValue(manifest, /^\s+sha512:\s*(.+)$/m, 'files.sha512');
  const size = Number(matchValue(manifest, /^\s+size:\s*(\d+)\s*$/m, 'files.size'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('버전은 x.y.z 형식이어야 합니다.');
  if (installerName !== `BrandConnect-Automation-Setup-${version}.exe`) throw new Error('설치 파일명과 버전이 일치하지 않습니다.');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512) || !Number.isSafeInteger(size) || size < 1) throw new Error('latest.yml의 파일 정보가 올바르지 않습니다.');
  return { version, installerName, sha512, size };
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value);
  return btoa(binary);
}

async function installerHashes(file: File): Promise<{ sha512: string; sha256: string }> {
  const bytes = await file.arrayBuffer();
  const sha512 = toBase64(await crypto.subtle.digest('SHA-512', bytes));
  const sha256 = toHex(await crypto.subtle.digest('SHA-256', bytes));
  return { sha512, sha256 };
}

async function sha256(file: File): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}

export function UpdateReleaseManager() {
  const [release, setRelease] = useState<Release | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [installerFile, setInstallerFile] = useState<File | null>(null);
  const [blockmapFile, setBlockmapFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    void api<{ release: Release | null }>(fetch(endpoint, { cache: 'no-store' }))
      .then((data) => setRelease(data.release || null))
      .catch((error) => setMessage(error instanceof Error ? error.message : '업데이트 상태를 읽지 못했습니다.'));
  }, []);

  const ready = useMemo(() => Boolean(manifestFile && installerFile && blockmapFile && !busy), [manifestFile, installerFile, blockmapFile, busy]);

  async function uploadArtifact(file: File, hashes: { sha512?: string; sha256?: string }, label: string) {
    let uploadId = '';
    try {
      const begin = await api<{ uploadId: string }>(fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'begin', artifactName: file.name, size: file.size, ...hashes }),
      }));
      uploadId = begin.uploadId;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      let offset = 0;
      let partNumber = 1;
      while (offset < file.size) {
        const end = Math.min(offset + partSize, file.size);
        const url = new URL(endpoint, window.location.origin);
        url.searchParams.set('artifactName', file.name);
        url.searchParams.set('uploadId', uploadId);
        url.searchParams.set('partNumber', String(partNumber));
        const uploaded = await api<{ partNumber: number; etag: string }>(fetch(url, { method: 'PUT', body: file.slice(offset, end) }));
        parts.push(uploaded);
        offset = end;
        setProgress(`${label} 업로드 ${Math.round((offset / file.size) * 100)}%`);
        partNumber += 1;
      }
      await api<{ key: string; size: number; etag: string }>(fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', artifactName: file.name, uploadId, parts }),
      }));
    } catch (error) {
      if (uploadId) {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'abort', artifactName: file.name, uploadId }),
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manifestFile || !installerFile || !blockmapFile) return;
    setBusy(true);
    setMessage('');
    try {
      const manifest = await manifestFile.text();
      const parsed = parseManifest(manifest);
      if (installerFile.name !== parsed.installerName || installerFile.size !== parsed.size) throw new Error('선택한 설치 파일이 latest.yml과 일치하지 않습니다.');
      if (blockmapFile.name !== `${parsed.installerName}.blockmap`) throw new Error('선택한 blockmap 파일명이 설치 파일과 일치하지 않습니다.');
      if (!window.confirm(`${parsed.version} 버전을 모든 연결 PC의 자동 업데이트로 배포할까요?`)) return;
      setProgress('설치 파일 SHA-512 무결성 확인 중');
      const verifiedInstallerHashes = await installerHashes(installerFile);
      if (verifiedInstallerHashes.sha512 !== parsed.sha512) throw new Error('설치 파일 SHA-512가 latest.yml과 일치하지 않습니다.');
      setProgress('Blockmap 무결성 확인 중');
      const blockmapSha256 = await sha256(blockmapFile);
      await uploadArtifact(blockmapFile, { sha256: blockmapSha256 }, 'Blockmap');
      await uploadArtifact(installerFile, verifiedInstallerHashes, '설치 파일');
      setProgress('업데이트 채널 활성화 중');
      const published = await api<{ release: Release }>(fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish', manifest }),
      }));
      setRelease(published.release);
      setMessage(`${published.release.version} 버전 배포가 완료되었습니다. 연결된 PC가 자동으로 내려받습니다.`);
      setProgress('');
      setManifestFile(null);
      setInstallerFile(null);
      setBlockmapFile(null);
      setFormKey((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업데이트 배포에 실패했습니다.');
      setProgress('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-card update-release-card">
      <div className="card-title">
        <div><span className="card-kicker">DESKTOP RELEASE</span><h2>자동 업데이트 배포</h2></div>
        <span className="number-chip">{release ? `v${release.version}` : '미배포'}</span>
      </div>
      <p className="release-explainer">새 설치본과 메타데이터를 올리면 연결된 PC가 자동으로 다운로드하고, 진행 중인 포스팅이 끝난 뒤 자동 재시작합니다.</p>
      {release && <div className="current-release"><strong>{release.installerName}</strong><span>{formatBytes(release.installerSize)} · {new Date(release.publishedAt).toLocaleString('ko-KR')}</span></div>}
      <form key={formKey} className="release-upload-form" onSubmit={publish}>
        <label><span>latest.yml</span><input type="file" accept=".yml,.yaml" disabled={busy} onChange={(event) => setManifestFile(event.target.files?.[0] || null)} /><small>{manifestFile?.name || '빌드 결과의 latest.yml'}</small></label>
        <label><span>Windows 설치 파일</span><input type="file" accept=".exe" disabled={busy} onChange={(event) => setInstallerFile(event.target.files?.[0] || null)} /><small>{installerFile ? `${installerFile.name} · ${formatBytes(installerFile.size)}` : '.exe 파일'}</small></label>
        <label><span>Blockmap</span><input type="file" accept=".blockmap" disabled={busy} onChange={(event) => setBlockmapFile(event.target.files?.[0] || null)} /><small>{blockmapFile?.name || '.exe.blockmap 파일'}</small></label>
        <button className="button button-primary action-button" type="submit" disabled={!ready}>{busy ? (progress || '배포 중') : '새 버전 중앙 배포'}</button>
      </form>
      {(message || progress) && <p className="inline-message" role="status">{message || progress}</p>}
    </section>
  );
}
