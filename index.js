import express from 'express'
import { runAccessibilityScan } from './accessibilityTest'
const app = express()
app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello')
})

app.post('/scan', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'Missing URL' })

  try {
    const results = await runAccessibilityScan({ startUrl: url })
    return res.json({ success: true, results })
  } catch (err) {
    console.error('Scan failed:', err)
    return res.status(500).json({ success: false, error: 'Scan failed' })
  }
})

app.listen(3001, () => {
  console.log('LISTENING ON PORT 3001')
})