import { getProviders, getModels } from "@mariozechner/pi-ai"

/** Lazy-built lookup from model ID to display name. */
let _modelNames: Map<string, string> | null = null

/** Resolve a model ID (bare or provider-prefixed) to its display name. */
export function getModelName(id: string): string {
  if (!_modelNames) {
    _modelNames = new Map()
    for (const provider of getProviders()) {
      for (const model of getModels(provider)) {
        _modelNames.set(model.id, model.name)
      }
    }
  }
  const name = _modelNames.get(id)
  if (name) return name
  // ctx.model?.id uses "provider/model" format, registry uses bare "model"
  const bare = id.includes("/") ? id.split("/").pop()! : null
  return (bare && _modelNames.get(bare)) ?? id
}
