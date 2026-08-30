import { getAdminQualityDashboard } from "../src/lib/admin-quality";

async function main() {
  const result = await getAdminQualityDashboard(1);
  if (Object.keys(result.sections).length !== 13) {
    throw new Error("Expected all 13 admin metric families");
  }
  console.log(JSON.stringify({
    version: result.version,
    days: result.window.days,
    sectionCount: Object.keys(result.sections).length,
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});