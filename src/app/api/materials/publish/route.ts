import { NextRequest } from "next/server";
import { materialsPost } from "@/lib/material-api";
export const POST = (request: NextRequest) => materialsPost(request, "publish");
