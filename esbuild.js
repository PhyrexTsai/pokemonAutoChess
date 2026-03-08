const fs = require("fs")
const { context } = require("esbuild")
const dotenv = require("dotenv")

dotenv.config()

const isDev = process.argv[2] === "--dev"
const isProdBuild = process.argv[2] === "--build"

let hashIndexPlugin = {
  name: "hash-index-plugin",
  setup(build) {
    build.onStart(() => {
      const files = fs.readdirSync("app/public/dist/client")
      files.forEach((file) => {
        if (file.startsWith("index-") && (file.endsWith(".js") || file.endsWith(".css"))) {
          try {
            fs.unlinkSync(`app/public/dist/client/${file}`)
          } catch (e) {
            if (e.code !== "ENOENT") throw e
          }
        }
      })
    })
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.log(`build ended with ${result.errors.length} errors`)
      }
      updateHashedFilesInIndex()
    })
  }
}

context({
  entryPoints: ["./app/public/src/index.tsx"],
  entryNames: isDev ? "[dir]/[name]" : "[dir]/[name]-[hash]",
  assetNames: "[dir]/[name]-[hash]",
  outfile: "app/public/dist/client/index.js",
  external: ["assets/*"],
  bundle: true,
  metafile: true,
  minify: isProdBuild,
  sourcemap: isProdBuild,
  plugins: isDev ? [] : [hashIndexPlugin],
  target: "es2016",
  define: {
    "process.env.DISCORD_SERVER": `"${process.env.DISCORD_SERVER}"`,
    "process.env.MIN_HUMAN_PLAYERS": `"${process.env.MIN_HUMAN_PLAYERS}"`,
    "process.env.MODE": `"${process.env.MODE || ""}"`,
    "process.env.NODE_ENV": `"${process.env.NODE_ENV || "development"}"`,
  }
})
  .then((ctx) => {
    if (isDev) {
      ctx.watch()
      ctx.serve({
        servedir: "app/public/dist/client",
        fallback: "app/public/dist/client/index.html",
        port: 9000
      }).then(({ host, port }) => {
        console.log(`Dev server running at http://${host}:${port}`)
      })
    } else {
      // Build once and exit if not in watch mode
      ctx.rebuild().then((result) => {
        if (result.metafile) {
          // use https://esbuild.github.io/analyze/ to analyse
          fs.writeFileSync(
            "app/public/dist/client/esbuild.meta.json",
            JSON.stringify(result.metafile)
          )
        }
        ctx.dispose()
      })
    }
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

function updateHashedFilesInIndex() {
  //update hash in index.html
  const fs = require("fs")
  const path = require("path")

  const distDir = path.join(__dirname, "app/public/dist/client")
  const htmlFile = path.join(__dirname, "app/views/index.html")
  const htmlOutputFile = path.join(distDir, "index.html")

  // Find the hashed script file
  const scriptFile = fs
    .readdirSync(distDir)
    .find((file) => file.startsWith("index-") && file.endsWith(".js"))
  const cssFile = fs
    .readdirSync(distDir)
    .find((file) => file.startsWith("index-") && file.endsWith(".css"))

  if (scriptFile) {
    // Read the HTML file
    let htmlContent = fs.readFileSync(htmlFile, "utf8")

    // Replace the placeholder with the actual script tag
    htmlContent = htmlContent
      .replace(
        '<script src="index.js" defer></script>',
        `<script src="${scriptFile}" defer></script>`
      )
      .replace(
        `<link rel="stylesheet" type="text/css" href="index.css" />`,
        `<link rel="stylesheet" type="text/css" href="${cssFile}">`
      )

    // Write the updated HTML back to the file
    fs.writeFileSync(htmlOutputFile, htmlContent, "utf8")
  } else {
    console.error("Hashed entry files not found.")
  }
}
