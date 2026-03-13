import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { ingestFile } from "@/lib/services/ingestion";
import { SourcePlatform } from "@/lib/parsers";
import {
  createProgressCallback,
  completeProgress,
  failProgress,
  setProgress,
} from "@/lib/services/progress";

const UPLOAD_DIR = join(process.cwd(), "uploads");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const platform = formData.get("platform") as string | null;
    const forceImport = formData.get("forceImport") === "true";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "tsv", "xlsx", "xls"].includes(ext)) {
      return NextResponse.json(
        { error: "Unsupported file type. Accepted: CSV, TSV, XLSX, XLS" },
        { status: 400 }
      );
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Save file to disk with unique name
    const timestamp = Date.now();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const savedFileName = `${timestamp}_${safeFileName}`;
    const filePath = join(UPLOAD_DIR, savedFileName);

    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // Generate operation ID for progress tracking
    const operationId = randomUUID();
    setProgress(operationId, {
      phase: "starting",
      current: 0,
      total: 0,
      message: "Starting import...",
      done: false,
    });

    // Run ingestion in background with progress updates
    const onProgress = createProgressCallback(operationId);

    ingestFile(
      filePath,
      fileName,
      platform ? (platform as SourcePlatform) : undefined,
      {
        skipFileDedup: forceImport,
        skipRowDedup: false,
        onProgress,
      }
    )
      .then((result) => {
        if (result.duplicate?.isDuplicate) {
          completeProgress(operationId, {
            duplicate: true,
            existingImportId: result.duplicate.existingImportId,
            existingFileName: result.duplicate.existingFileName,
            importedAt: result.duplicate.importedAt,
            message: `This file was already imported as "${result.duplicate.existingFileName}" on ${new Date(result.duplicate.importedAt).toLocaleDateString()}.`,
          });
        } else {
          completeProgress(operationId, result);
        }
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown error during upload";
        failProgress(operationId, message);
      });

    return NextResponse.json({ operationId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
