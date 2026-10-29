import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import express, { type NextFunction, type Request, type Response } from 'express'
import { figmaRouter } from './figma.ts'
import { klaviyoRouter, KLAVIYO_REVISION } from './klaviyo.ts'
import { campaignRouter } from './campaign.ts'
import { asanaRouter } from './asana.ts'
import { HttpError } from './http.ts'

const PORT = Number(process.env.PORT || 8787)
const app = express()
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    figmaTokenConfigured: Boolean(process.env.FIGMA_TOKEN),
    klaviyoKeyConfigured: Boolean(process.env.KLAVIYO_PRIVATE_KEY),
    asanaTokenConfigured: Boolean(process.env.ASANA_TOKEN),
    klaviyoRevision: KLAVIYO_REVISION,
  })
})

app.use('/api/figma', figmaRouter)
app.use('/api/klaviyo/campaign', campaignRouter)
app.use('/api/klaviyo', klaviyoRouter)
app.use('/api/asana', asanaRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Serve the built UI in production (`npm start`).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : (err as any)?.code === 'LIMIT_FILE_SIZE' ? 413 : 500
  const message =
    (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds Klaviyo\'s 5 MB limit' : (err as Error)?.message || 'Server error'
  if (status >= 500) console.error(err)
  res.status(status).json({ error: message, details: err instanceof HttpError ? err.details : undefined })
})

app.listen(PORT, () => {
  console.log(`\n  ✉  Klaviyo Email Slicer API → http://localhost:${PORT}`)
  console.log(`     Figma token: ${process.env.FIGMA_TOKEN ? 'from environment' : 'not set (enter in Settings)'}`)
  console.log(`     Klaviyo key: ${process.env.KLAVIYO_PRIVATE_KEY ? 'from environment' : 'not set (enter in Settings)'}`)
  console.log(`     Asana token: ${process.env.ASANA_TOKEN ? 'from environment' : 'not set (enter in Settings)'}\n`)
})
