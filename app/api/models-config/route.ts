import { NextResponse } from "next/server";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { refreshModelCatalog } from "@/lib/model-catalog-refresh";
import { readModelConfiguration, saveModelConfiguration } from "@/lib/model-config-store";
import { ModelConfigurationError } from "@/lib/typed-model-config";
import { notifyResourceConfigurationChanged } from "@/lib/session-resource-events";

export const dynamic = "force-dynamic";
const modelsPath = () => join(getAgentDir(), "models.json");

export async function GET() {
  try { return NextResponse.json(await readModelConfiguration(modelsPath())); }
  catch { return NextResponse.json({ error: "Unable to read model configuration" }, { status: 500 }); }
}

export async function PUT(req: Request) {
  try {
    await saveModelConfiguration(modelsPath(), await req.json());
    invalidateModelsCache();
    notifyResourceConfigurationChanged();
    void refreshModelCatalog("openrouter").catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ModelConfigurationError ? error.message : "Unable to save model configuration" },
      { status: error instanceof ModelConfigurationError ? 400 : 500 });
  }
}
