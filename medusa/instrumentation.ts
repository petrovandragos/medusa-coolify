import { registerStaticFileCache } from "./src/utils/static-cache"

/**
 * `medusa start` calls `register` before it creates the HTTP server.
 * That is the only project hook that runs before the framework mounts
 * `/static` with `express.static` and the default `max-age=0`.
 *
 * To enable OpenTelemetry, keep the `registerStaticFileCache()` call and
 * add the exporter setup from the commented example below inside this function.
 * https://docs.medusajs.com/learn/debugging-and-testing/instrumentation
 */
export function register() {
  registerStaticFileCache()
}

// Uncomment this file to enable instrumentation and observability using OpenTelemetry
// Refer to the docs for installation instructions: https://docs.medusajs.com/learn/debugging-and-testing/instrumentation

// import { registerOtel } from "@medusajs/medusa"
// // If using an exporter other than Zipkin, require it here.
// import { ZipkinExporter } from "@opentelemetry/exporter-zipkin"

// // If using an exporter other than Zipkin, initialize it here.
// const exporter = new ZipkinExporter({
//   serviceName: 'my-medusa-project',
// })

// export function register() {
//   registerOtel({
//     serviceName: 'medusajs',
//     // pass exporter
//     exporter,
//     instrument: {
//       http: true,
//       workflows: true,
//       query: true
//     },
//   })
// }