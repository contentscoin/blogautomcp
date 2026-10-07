import { NextRequest } from "next/server";
import { materialsRewriteFailedPost } from "@/lib/material-api";
export const POST = (request: NextRequest) => materialsRewriteFailedPost(request);
