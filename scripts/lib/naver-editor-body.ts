import type { ResolvedPostDocumentV1 } from "../../src/lib/post-composition-contract";
import { assertPublishedEditorText } from "./published-editor-audit";

export interface NaverEditorBodySnapshot {
  version: "naver-editor-body/v1";
  scope: "confirmed" | "missing" | "ambiguous";
  reason: string;
  rootSelector: string | null;
  rootCount: number;
  componentCount: number;
  excludedTitleCount: number;
  excludedUiCount: number;
  leadingContent: "none" | "text" | "visual";
  text: string;
  textLength: number;
  unscopedTextPrefix: string;
  components: Array<{ className: string; textLength: number; prefix: string }>;
}

/** Self-contained: Playwright serializes this function into the editor page. */
export function readNaverEditorBodySnapshot(): NaverEditorBodySnapshot {
  const result: NaverEditorBodySnapshot = {
    version: "naver-editor-body/v1", scope: "missing", reason: "editor-root-missing",
    rootSelector: null, rootCount: 0, componentCount: 0, excludedTitleCount: 0,
    excludedUiCount: 0, leadingContent: "none", text: "", textLength: 0, unscopedTextPrefix: "", components: [],
  };
  // SmartEditor 1.78.1's insert menu includes a clipped .se-blind label:
  // "추가할 컴포넌트를 선택하세요." It is editor chrome, not article text.
  // Exclude its owned menu, never arbitrary body text matching that phrase.
  const uiSelector = '.se-toolbar, .se-toolbar-container, .se-toolbar-option, .se-popup, .se-popup-container, .se-menu, .se-insert-menu, .se-component-edge-button, .se-placeholder, .__se_placeholder, [role="toolbar"], [role="menu"], [role="dialog"]';
  const maxComponents = 256;
  const maxText = 100_000;
  const maxNodes = 20_000;
  const blockTags = new Set(["P", "DIV", "LI", "UL", "OL", "SECTION", "ARTICLE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TD"]);
  const visible = (element: Element): boolean => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number.parseFloat(style.opacity) === 0) return false;
    }
    return true;
  };
  const mainRoots = Array.from(document.querySelectorAll(".se-main-container")).filter(visible);
  const fallbackRoots = Array.from(document.querySelectorAll(".se-content")).filter(visible);
  // A nested alias is the same editor scope. A separate visible fallback is not.
  const independentFallbackRoots = fallbackRoots.filter(fallback => !mainRoots.some(main =>
    main === fallback || main.contains(fallback) || fallback.contains(main)));
  const roots = mainRoots.length ? [...mainRoots, ...independentFallbackRoots] : fallbackRoots;
  result.rootSelector = mainRoots.length ? ".se-main-container" : ".se-content";
  result.rootCount = roots.length;
  if (roots.length !== 1) {
    result.scope = roots.length ? "ambiguous" : "missing";
    result.reason = roots.length ? "multiple-visible-editor-roots" : "editor-root-missing";
    return result;
  }
  const root = roots[0]!;
  result.excludedTitleCount = Array.from(root.querySelectorAll(".se-documentTitle")).filter(visible).length;
  result.excludedUiCount = Array.from(root.querySelectorAll(uiSelector)).filter(visible).length;
  const components = Array.from(root.querySelectorAll(".se-component")).filter(element => {
    if (!visible(element) || element.closest(".se-documentTitle") || element.closest(uiSelector)) return false;
    // A containing body component owns its nested contents; never read them twice.
    const ancestor = element.parentElement?.closest(".se-component");
    return !ancestor || !root.contains(ancestor);
  });
  result.componentCount = components.length;
  if (!components.length || components.length > maxComponents) {
    result.scope = components.length ? "ambiguous" : "missing";
    result.reason = components.length ? "body-component-limit" : "body-components-missing";
    return result;
  }
  const outerAliases = fallbackRoots.filter(fallback => fallback !== root && fallback.contains(root));
  for (const outer of outerAliases) {
    // Containment alone does not make two selectors aliases: an outer wrapper
    // may contain another real body before/after the chosen main container.
    const outsideComponents = Array.from(outer.querySelectorAll(".se-component")).filter(element =>
      !root.contains(element) && visible(element) && !element.closest(".se-documentTitle") && !element.closest(uiSelector));
    if (outsideComponents.length) {
      result.scope = "ambiguous";
      result.reason = "body-components-outside-selected-root";
      result.rootCount += 1;
      return result;
    }
  }
  let nodeCount = 0;
  let textLength = 0;
  let exceeded = false;
  let unscopedVisual = false;
  const isVisualContent = (element: Element) =>
    ["IMG", "VIDEO", "IFRAME", "CANVAS", "HR"].includes(element.tagName) ||
    element.matches(".se-image, .se-video, .se-oglink, .se-horizontalLine, .se-module-image, .se-module-video, .se-module-oglink");
  const read = (node: Node, outsideComponents: boolean, depth = 0): string => {
    if (++nodeCount > maxNodes || depth > 128) { exceeded = true; return ""; }
    if (node.nodeType === 3) {
      const text = node.nodeValue || "";
      // Editor caret placeholders are invisible, just as in the final audit's
      // compact comparison. They cannot make a preceding image look like text.
      if (!outsideComponents && result.leadingContent === "none" && text.replace(/[\s\u200b-\u200d\ufeff]+/gu, "")) result.leadingContent = "text";
      textLength += text.length;
      if (textLength > maxText) { exceeded = true; return ""; }
      return text;
    }
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    if (!visible(element) || element.matches(".se-documentTitle") || element.matches(uiSelector)) return "";
    if (outsideComponents && element.matches(".se-component")) return "";
    if (isVisualContent(element)) {
      if (outsideComponents) unscopedVisual = true;
      else if (result.leadingContent === "none") result.leadingContent = "visual";
    }
    if (element.tagName === "BR") return "\n";
    const chunks: string[] = [];
    for (const child of Array.from(element.childNodes)) {
      chunks.push(read(child, outsideComponents, depth + 1));
      if (exceeded) break;
    }
    const text = chunks.join("");
    return blockTags.has(element.tagName) ? `\n${text}\n` : text;
  };
  const texts: string[] = [];
  for (const component of components) {
    const text = read(component, false).trim();
    texts.push(text);
    if (result.components.length < 24) result.components.push({
      className: (component.getAttribute("class") || "").slice(0, 160),
      textLength: text.length, prefix: text.slice(0, 120),
    });
    if (exceeded) break;
  }
  let unscoped = exceeded ? "" : read(root, true).trim();
  if (!unscoped && !unscopedVisual && !exceeded) {
    for (const outer of outerAliases) {
      // The body components (including the chosen root's) are skipped. Only
      // visible text outside their established scope can remain here.
      unscoped = read(outer, true).trim();
      if (unscoped || unscopedVisual || exceeded) break;
    }
  }
  result.unscopedTextPrefix = unscoped.slice(0, 160);
  result.textLength = texts.join("\n").length;
  if (exceeded || result.textLength > maxText || unscoped || unscopedVisual) {
    result.scope = "ambiguous";
    result.reason = exceeded || result.textLength > maxText ? "body-read-limit" : unscopedVisual ? "unscoped-visible-visual" : "unscoped-visible-text";
    // Never validate a truncated or uncertain body as if it were complete.
    return result;
  }
  result.text = texts.join("\n");
  result.scope = "confirmed";
  result.reason = "visible-body-components";
  return result;
}

export type NaverEditorAuditPhase = "disclosure" | "final";

export interface NaverEditorTypingFocus {
  bodyFocused: boolean;
  reason: string;
  rootCount: number;
  selectedBodyCount: number;
  selectedTextBodyCount: number;
  selectedTitleCount: number;
  inputBufferCount: number;
  selectedBodyId: string | null;
  inputBufferId: string | null;
  bufferRestorationAllowed: boolean;
  activeKind: "input-buffer" | "body-editable" | "title" | "editor-ui" | "outside";
}

/** Self-contained page reader. SmartEditor types through its input_buffer iframe,
 * not a contenteditable paragraph. A selected title uses the same buffer, so
 * buffer focus alone is never sufficient proof of a body insertion target. */
export function readNaverEditorTypingFocus(): NaverEditorTypingFocus {
  const result: NaverEditorTypingFocus = { bodyFocused: false, reason: "body-focus-missing", rootCount: 0,
    selectedBodyCount: 0, selectedTextBodyCount: 0, selectedTitleCount: 0, inputBufferCount: 0, selectedBodyId: null,
    inputBufferId: null, bufferRestorationAllowed: false, activeKind: "outside" };
  const uiSelector = '.se-toolbar, .se-toolbar-container, .se-toolbar-option, .se-popup, .se-popup-container, .se-menu, .se-insert-menu, .se-component-edge-button, .se-placeholder, .__se_placeholder, [role="toolbar"], [role="menu"], [role="dialog"]';
  const visible = (element: Element): boolean => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number.parseFloat(style.opacity) === 0) return false;
    }
    return true;
  };
  const mainRoots = Array.from(document.querySelectorAll(".se-main-container")).filter(visible);
  const fallbacks = Array.from(document.querySelectorAll(".se-content")).filter(visible);
  const roots = mainRoots.length ? [...mainRoots, ...fallbacks.filter(fallback => !mainRoots.some(main =>
    main === fallback || main.contains(fallback) || fallback.contains(main)))] : fallbacks;
  result.rootCount = roots.length;
  if (roots.length !== 1) { result.reason = roots.length ? "multiple-visible-editor-roots" : "editor-root-missing"; return result; }
  const root = roots[0]!;
  const selected = Array.from(root.querySelectorAll(".se-component.se-is-selected")).filter(element =>
    visible(element) && !element.closest(uiSelector) && !element.closest(".se-documentTitle"));
  const isTextOwner = (element: Element) => element.matches(".se-text, .se-sectionTitle") &&
    Array.from(element.querySelectorAll(".se-text-paragraph")).some(paragraph =>
      paragraph.closest(".se-component") === element && visible(paragraph));
  result.selectedBodyCount = selected.length;
  result.selectedTextBodyCount = selected.filter(isTextOwner).length;
  result.selectedBodyId = selected.length === 1 ? selected[0]!.getAttribute("data-compid") || selected[0]!.id || null : null;
  result.selectedTitleCount = Array.from(document.querySelectorAll(".se-documentTitle.se-is-selected")).filter(visible).length;
  const active = document.activeElement;
  const owner = active?.closest(".se-component");
  if (active?.closest(".se-documentTitle")) result.activeKind = "title";
  else if (active?.closest(uiSelector)) result.activeKind = "editor-ui";
  else if (active && (active as HTMLElement).isContentEditable && owner && root.contains(owner) && visible(owner) && isTextOwner(owner) &&
      active.closest(".se-text-paragraph")?.closest(".se-component") === owner) {
    result.activeKind = "body-editable";
    result.bodyFocused = result.selectedTitleCount === 0 && (selected.length === 0 || selected.length === 1 && selected[0] === owner);
    // Native editable focus identifies its exact owning component even when
    // the editor has not applied a virtual-selection class.
    if (!selected.length) result.selectedBodyId = owner.getAttribute("data-compid") || owner.id || null;
  }
  // This is SmartEditor's server-owned, offscreen keyboard buffer. Its title
  // and editable body identify the widget without accepting arbitrary iframes.
  const buffers = Array.from(document.querySelectorAll('iframe[id^="input_buffer"]')).filter(element => {
    if (!/스마트\s*에디터/u.test(element.getAttribute("title") || "")) return false;
    try { return (element as HTMLIFrameElement).contentDocument?.body?.isContentEditable === true; } catch { return false; }
  });
  result.inputBufferCount = buffers.length;
  result.inputBufferId = buffers.length === 1 ? buffers[0]!.id : null;
  if (active && buffers.includes(active)) {
    result.activeKind = "input-buffer";
    result.bodyFocused = buffers.length === 1 && result.selectedBodyCount === 1 && result.selectedTextBodyCount === 1 && result.selectedTitleCount === 0;
  }
  const toolbarControl = active?.closest('.se-toolbar, .se-toolbar-container, .se-toolbar-option, [role="toolbar"]');
  const editableControl = active && (active.matches("input, textarea, select") || (active as HTMLElement).isContentEditable);
  result.bufferRestorationAllowed = !result.bodyFocused && buffers.length === 1 && result.selectedBodyCount === 1 && result.selectedTextBodyCount === 1 &&
    result.selectedTitleCount === 0 && Boolean(result.selectedBodyId) &&
    (active === document.body || active === document.documentElement || Boolean(toolbarControl && !editableControl));
  result.reason = result.bodyFocused ? "body-typing-focus-confirmed" : result.selectedTitleCount > 0 || result.activeKind === "title"
    ? "title-selected" : result.selectedBodyCount > 1 || buffers.length > 1 ? "multiple-editor-input-targets"
      : result.selectedBodyCount === 1 && result.selectedTextBodyCount !== 1 ? "body-selection-not-text" : "body-focus-missing";
  return result;
}

export function assertNaverEditorTypingFocus(focus: NaverEditorTypingFocus): void {
  if (!focus.bodyFocused) throw new Error(`EDITOR_BODY_FOCUS_UNCONFIRMED: 실제 본문 입력 위치를 확인할 수 없어 입력을 중단합니다 (${focus.reason}).`);
}

export function assertNaverEditorBody(
  document: ResolvedPostDocumentV1,
  snapshot: NaverEditorBodySnapshot,
  phase: NaverEditorAuditPhase,
): void {
  if (snapshot.scope !== "confirmed") {
    throw new Error(`EDITOR_BODY_SCOPE_${snapshot.scope === "missing" ? "MISSING" : "AMBIGUOUS"}: 실제 편집기 본문 범위를 확인할 수 없습니다 (${snapshot.reason}).`);
  }
  const first = document.renderNodes[0];
  if (first?.kind === "disclosure" && first.placement === "top" && snapshot.leadingContent !== "text") {
    throw new Error("EDITOR_DISCLOSURE_MISMATCH: 제휴 고지보다 먼저 표시되는 본문 이미지·컴포넌트가 있습니다.");
  }
  if (phase === "disclosure") {
    if (first?.kind !== "disclosure" || first.placement !== "top") {
      throw new Error("EDITOR_DISCLOSURE_MISMATCH: 상단 고지 렌더 계약을 확인할 수 없습니다.");
    }
    assertPublishedEditorText({ ...document, renderNodes: [first] }, snapshot.text);
    return;
  }
  assertPublishedEditorText(document, snapshot.text);
}

/** Bounded failure evidence only; never store the full DOM or full body. */
export function editorBodyAuditDiagnostic(snapshot: NaverEditorBodySnapshot, phase: NaverEditorAuditPhase, message: string, disclosureText = "") {
  const compact = (value: string) => value.normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]+/gu, "");
  const notice = compact(disclosureText);
  const actual = compact(snapshot.text);
  return {
    version: snapshot.version, phase, scope: snapshot.scope, reason: snapshot.reason,
    message: message.slice(0, 300), rootSelector: snapshot.rootSelector, rootCount: snapshot.rootCount,
    componentCount: snapshot.componentCount, excludedTitleCount: snapshot.excludedTitleCount,
    excludedUiCount: snapshot.excludedUiCount, textLength: snapshot.textLength,
    leadingContent: snapshot.leadingContent,
    disclosureOccurrences: notice && snapshot.scope === "confirmed" ? actual.split(notice).length - 1 : null,
    bodyPrefix: snapshot.text.slice(0, 300), bodySuffix: snapshot.text.slice(-160),
    unscopedTextPrefix: snapshot.unscopedTextPrefix.slice(0, 160),
    components: snapshot.components.slice(0, 24).map(component => ({
      className: component.className.slice(0, 160), textLength: component.textLength,
      prefix: component.prefix.slice(0, 120),
    })),
  };
}
