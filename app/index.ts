import { server } from "./app.config"

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 9000
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

main()
