import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import express from "express"
import type { AddressInfo } from "net"
import {
  IMMUTABLE_STATIC_CACHE_CONTROL,
  REVALIDATING_STATIC_CACHE_CONTROL,
  cacheControlForStaticFile,
  installStaticCacheHeaders,
  registerStaticFileCache,
} from "../static-cache"

const ORIGINAL_STATIC = express.static

function writeFile(dir: string, name: string) {
  const filePath = path.join(dir, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, "image-bytes")
}

async function withServer(
  app: express.Express,
  run: (port: number) => Promise<void>
) {
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  try {
    await run(address.port)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
  }
}

function get(
  port: number,
  urlPath: string
): Promise<{ status: number; cacheControl: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, host: "127.0.0.1", path: urlPath }, (res) => {
      res.resume()
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          cacheControl: res.headers["cache-control"],
        })
      )
    })
    req.on("error", reject)
  })
}

describe("static file cache headers", () => {
  afterEach(() => {
    express.static = ORIGINAL_STATIC
  })

  it("treats Medusa timestamped upload names as immutable", () => {
    expect(cacheControlForStaticFile("/var/static/1732704123456-oferta-1.png")).toBe(
      IMMUTABLE_STATIC_CACHE_CONTROL
    )
    expect(
      cacheControlForStaticFile(
        "/var/static/private-1732704123456-secret.pdf"
      )
    ).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
    expect(
      cacheControlForStaticFile(
        "/var/static/guides/1732704123456-manual.pdf"
      )
    ).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
  })

  it("revalidates names that can be overwritten in place", () => {
    expect(cacheControlForStaticFile("/var/static/oferta-1.png")).toBe(
      REVALIDATING_STATIC_CACHE_CONTROL
    )
    expect(cacheControlForStaticFile("/var/static/guides/manual.pdf")).toBe(
      REVALIDATING_STATIC_CACHE_CONTROL
    )
    expect(
      cacheControlForStaticFile("/var/static/123456789012-too-short.png")
    ).toBe(REVALIDATING_STATIC_CACHE_CONTROL)
    expect(
      cacheControlForStaticFile("/var/static/17327041234567-too-long.png")
    ).toBe(REVALIDATING_STATIC_CACHE_CONTROL)
  })

  it("sends long-lived headers from the same middleware Medusa uses for /static", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "medusa-static-"))
    const uploadDir = path.join(root, "static")
    const otherDir = path.join(root, "public")
    writeFile(uploadDir, "1732704123456-oferta-1.png")
    writeFile(uploadDir, "private-1732704123456-secret.pdf")
    writeFile(uploadDir, path.join("guides", "1732704123456-manual.pdf"))
    writeFile(uploadDir, "oferta-1.png")
    writeFile(otherDir, "1732704123456-oferta-1.png")

    installStaticCacheHeaders(express)
    installStaticCacheHeaders(express)

    const app = express()
    app.use("/static", express.static(uploadDir))
    app.use("/assets", express.static(otherDir))

    try {
      await withServer(app, async (port) => {
        const timestamped = await get(port, "/static/1732704123456-oferta-1.png")
        const privateFile = await get(
          port,
          "/static/private-1732704123456-secret.pdf"
        )
        const nested = await get(
          port,
          "/static/guides/1732704123456-manual.pdf?v=1"
        )
        const overwritten = await get(port, "/static/oferta-1.png")
        const otherRoot = await get(port, "/assets/1732704123456-oferta-1.png")

        expect(timestamped.status).toBe(200)
        expect(timestamped.cacheControl).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
        expect(privateFile.cacheControl).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
        expect(nested.cacheControl).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
        expect(overwritten.status).toBe(200)
        expect(overwritten.cacheControl).toBe(REVALIDATING_STATIC_CACHE_CONTROL)
        expect(otherRoot.cacheControl).toBe("public, max-age=0")
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("keeps a Cache-Control header already set by another static option", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "medusa-static-"))
    const uploadDir = path.join(root, "static")
    writeFile(uploadDir, "oferta-1.png")

    installStaticCacheHeaders(express)
    const app = express()
    app.use(
      "/static",
      express.static(uploadDir, {
        setHeaders(res) {
          res.setHeader("Cache-Control", "private, max-age=10")
        },
      })
    )

    try {
      await withServer(app, async (port) => {
        const response = await get(port, "/static/oferta-1.png")
        expect(response.cacheControl).toBe("private, max-age=10")
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("patches the express instance the process will use to serve files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "medusa-static-"))
    const uploadDir = path.join(root, "static")
    writeFile(uploadDir, "1732704123456-photo.png")

    registerStaticFileCache()
    const app = express()
    app.use("/static", express.static(uploadDir))

    try {
      await withServer(app, async (port) => {
        const response = await get(port, "/static/1732704123456-photo.png")
        expect(response.cacheControl).toBe(IMMUTABLE_STATIC_CACHE_CONTROL)
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
