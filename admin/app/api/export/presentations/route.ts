import { getAuthenticatedUser } from "@/lib/auth";
import { listPresentationsForExport } from "@/lib/db";
import { buildDownloadHeaders, buildPresentationsDataJs } from "@/lib/export";

export async function GET(request: Request) {
  await getAuthenticatedUser(request);
  const records = await listPresentationsForExport();
  const js = buildPresentationsDataJs(records);
  return new Response(js, {
    headers: buildDownloadHeaders("presentations_data.js"),
  });
}
