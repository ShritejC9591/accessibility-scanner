import { JSDOM } from 'jsdom'
import { readFile } from 'fs/promises'
import fetch from 'node-fetch'
import path from 'path'

export async function runAccessibilityScan({
    startUrl,
    maxDepth = 2,
    maxScans = 30
}) {
    const axeSource = await readFile(
        path.join(process.cwd(), 'node_modules', 'axe-core/axe.min.js'),
        'utf8'
    )

    const visited = new Set()
    const results = []
    let scanCount = 0

    async function scanPage(url, depth) {
        if (visited.has(url) || scanCount >= maxScans || depth > maxDepth) return
        visited.add(url)
        scanCount++

        try {
            const res = await fetch(url)
            if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) {
                console.warn(`Skipped non-HTML or failed page: ${url}`)
                return
            }

            const html = await res.text()
            const dom = new JSDOM(html, { url })
            const { window } = dom
            const { document } = window

            const script = document.createElement('script')
            script.textContent = axeSource
            document.head.appendChild(script)

            const axe = window.axe
            const result = await axe.run(document, {
                runOnly: {
                    type: 'tag',
                    values: ['wcag2a', 'wcag2aa']
                }
            })

            results.push({ url, result })
            console.log(`Scanned ${url}`)

            const origin = new URL(url).origin
            const links = Array.from(document.querySelectorAll('a'))
                .map(a => a.href.trim())
                .filter(href =>
                    href.startsWith(origin) &&
                    !href.includes('#') &&
                    !href.includes('mailto:') &&
                    !href.includes('tel:') &&
                    !href.endsWith('.pdf') &&
                    !href.endsWith('.jpg') &&
                    !href.endsWith('.png') &&
                    !visited.has(href)
                )

            for (const link of links) {
                await scanPage(link, depth + 1)
            }
        } catch (err) {
            console.error(`Failed to scan ${url}:`, err.message)
            throw new Error(`Scan failed for ${url}: ${err.message}`)
        }
    }

    await scanPage(startUrl, 0)
    return results
}
