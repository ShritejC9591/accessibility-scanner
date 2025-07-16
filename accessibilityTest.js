import puppeteer from 'puppeteer'
import path from 'path'
import { readFile } from 'fs/promises'

export async function runAccessibilityScan({
    startUrl,
    maxDepth = 3,
    maxScans = 50,
    concurrency = 5
}) {
    const axeSource = await readFile(
        path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
        'utf8'
    )

    const visited = new Set()
    const results = []
    let scanCount = 0

    const browser = await puppeteer.launch({ headless: true })

    async function extractInternalLinks(url) {
        const page = await browser.newPage()
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
            const origin = new URL(url).origin

            const links = await page.evaluate((originStr) => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href.trim())
                    .filter(href =>
                        href.startsWith(originStr) &&
                        !href.includes('#') &&
                        !href.includes('?') &&
                        !href.endsWith('.pdf') &&
                        !href.endsWith('.jpg') &&
                        !href.endsWith('.png') &&
                        !href.includes('mailto:') &&
                        !href.includes('tel:')
                    )
            }, origin)

            return [...new Set(links)]
        } catch {
            return []
        } finally {
            await page.close()
        }
    }

    async function scanPage(url) {
        if (scanCount >= maxScans) return null
        scanCount++

        const page = await browser.newPage()
        try {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
            await page.evaluate(axeSource)

            const result = await page.evaluate(() => {
                return window.axe.run({
                    runOnly: {
                        type: 'tag',
                        values: ['wcag2a', 'wcag2aa', 'wcag2aaa']
                    }
                })
            })

            console.log(`Scanned: ${url}`)
            return { url, result }
        } catch (err) {
            console.error(`Failed to scan: ${url}`, err.message)
            return null
        } finally {
            await page.close()
        }
    }

    async function scanWithConcurrency(urls) {
        const batches = []

        for (let i = 0; i < urls.length; i += concurrency) {
            batches.push(urls.slice(i, i + concurrency))
        }

        for (const batch of batches) {
            const resultsInBatch = await Promise.all(batch.map(scanPage))
            resultsInBatch.forEach(res => {
                if (res) results.push(res)
            })
        }
    }

    let currentLevel = [{ url: startUrl, depth: 0 }]
    visited.add(startUrl)

    while (currentLevel.length > 0 && scanCount < maxScans) {
        const urlsToScan = currentLevel.map(n => n.url)
        await scanWithConcurrency(urlsToScan)

        const nextLevel = []

        for (const { url, depth } of currentLevel) {
            if (depth >= maxDepth || scanCount >= maxScans) continue

            const links = await extractInternalLinks(url)
            for (const link of links) {
                if (!visited.has(link)) {
                    visited.add(link)
                    nextLevel.push({ url: link, depth: depth + 1 })
                }
            }
        }

        currentLevel = nextLevel
    }

    await browser.close()
    return results
}
