import { NextRequest } from "next/server";
import { materialsRepairBlockedPost } from "@/lib/material-api";
export const POST = (request: NextRequest) => materialsRepairBlockedPost(request);
