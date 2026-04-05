import { getAuthenticatedUser } from "@/lib/auth";
import { listPublicationsForExport } from "@/lib/db";
import { buildDownloadHeaders, buildPublicationsDataJs } from "@/lib/export";

export async function GET(request: Request) {
  await getAuthenticatedUser(request);
  const records = await listPublicationsForExport();
  const js = buildPublicationsDataJs(records);
  return new Response(js, {
    headers: buildDownloadHeaders("publications_data.js"),
  });
}
