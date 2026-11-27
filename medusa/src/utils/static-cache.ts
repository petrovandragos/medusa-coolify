import { createRequire } from "module"
import path from "path"
import express from "express"

/**
 * Local uploads are served by Medusa 2.8.8 here:
 * `app.use("/static", express.static(path.join(baseDir, "static")))`
 * with no options. `serve-static` then sends `Cache-Control: public, max-age=0`.
 * The framework does not expose a setting for that middleware, so `instrumentation.ts`
 * wraps `express.static` before the server is created.
 *
 * `@medusajs/file-local` names each upload `{Date.now()}-{original}` (private files
 * use `private-{Date.now()}-{original}`). A replacement is a new file and a new URL,
 * so those responses can be cached immutably. A name like `oferta-1.png` is not
 * produced by this provider; it can be overwritten in place, so it must expire.
 */
export const IMMUTABLE_STATIC_CACHE_CONTROL =
  "public, max-age=31536000, immutable"

export const REVALIDATING_STATIC_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800"

const IMMUTABLE_UPLOAD_FILENAME =
  /(?:^|[/\\])(?:private-)?\d{13}-[^/\\]+$/

const PATCHED = Symbol.for("medusa.staticCache.patched")

type HeaderResponse = {
  getHeader(name: string): number | string | string[] | undefined
  setHeader(name: string, value: string): void
}

type SetHeaders = (
  res: HeaderResponse,
  filePath: string,
  stat: unknown
) => void

type StaticOptions = {
  setHeaders?: SetHeaders
} & Record<string, unknown>

type StaticMiddleware = {
  (root: string, options?: StaticOptions): express.RequestHandler
  [PATCHED]?: boolean
}

type ExpressLike = {
  static: StaticMiddleware
}

export function cacheControlForStaticFile(filePath: string): string {
  return IMMUTABLE_UPLOAD_FILENAME.test(filePath)
    ? IMMUTABLE_STATIC_CACHE_CONTROL
    : REVALIDATING_STATIC_CACHE_CONTROL
}

export function isMedusaUploadStaticRoot(root: string): boolean {
  return path.basename(path.resolve(root)) === "static"
}

export function installStaticCacheHeaders(
  expressModule: ExpressLike = express
): void {
  const current = expressModule.static
  if (current[PATCHED]) {
    return
  }

  const patched = function staticWithCache(
    root: string,
    options?: StaticOptions
  ) {
    if (!isMedusaUploadStaticRoot(root)) {
      return current(root, options)
    }

    const userSetHeaders = options?.setHeaders
    return current(root, {
      ...options,
      setHeaders(res, filePath, stat) {
        userSetHeaders?.(res, filePath, stat)
        if (!res.getHeader("Cache-Control")) {
          res.setHeader("Cache-Control", cacheControlForStaticFile(filePath))
        }
      },
    })
  } as StaticMiddleware

  for (const key of Object.getOwnPropertyNames(current)) {
    if (key === "length" || key === "name" || key === "prototype") {
      continue
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) {
      Object.defineProperty(patched, key, descriptor)
    }
  }

  patched[PATCHED] = true
  expressModule.static = patched
}

function isExpressPackageEntry(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/")
  return (
    normalized.endsWith("/node_modules/express/index.js") ||
    normalized.endsWith("/node_modules/express/lib/express.js")
  )
}

/**
 * Patch every `express` copy already loaded in this process, plus the one
 * resolved from here. `medusa start` imports the framework before
 * `instrumentation.register()`, so the instance that will serve `/static`
 * is already in `require.cache`.
 */
export function registerStaticFileCache(): void {
  const nodeRequire = createRequire(__filename)
  const seen = new Set<ExpressLike>()

  const patch = (mod: ExpressLike | undefined) => {
    if (!mod || typeof mod.static !== "function" || seen.has(mod)) {
      return
    }
    seen.add(mod)
    installStaticCacheHeaders(mod)
  }

  patch(nodeRequire("express"))
  patch(express)

  for (const filename of Object.keys(nodeRequire.cache)) {
    if (!isExpressPackageEntry(filename)) {
      continue
    }
    patch(nodeRequire.cache[filename]?.exports as ExpressLike | undefined)
  }
}
