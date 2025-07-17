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

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    })

    async function preparePage(page) {
        await page.setUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        await page.setJavaScriptEnabled(true)

        await page.setRequestInterception(true)
        page.on('request', req => {
            const blocked = ['image', 'stylesheet', 'font', 'media']
            if (blocked.includes(req.resourceType())) {
                req.abort()
            } else {
                req.continue()
            }
        })
    }

    async function extractInternalLinks(url) {
        const page = await browser.newPage()
        await preparePage(page)
        try {
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            })

            const origin = new URL(url).origin

            const links = await page.evaluate(originStr => {
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
        } catch (err) {
            console.error(`Failed to extract links from ${url}:`, err.message)
            return []
        } finally {
            await page.close()
        }
    }

    async function scanPage(url) {
        if (scanCount >= maxScans) return null
        scanCount++

        const page = await browser.newPage()
        await preparePage(page)
        try {
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            })

            await page.evaluate(axeSource)

            const result = await page.evaluate(async () => {
                return await window.axe.run({
                    runOnly: {
                        type: 'tag',
                        values: ['wcag2a', 'wcag2aa', 'wcag2aaa']
                    }
                })
            })

            console.log(`Scanned: ${url}`)
            return { url, result }
        } catch (err) {
            console.error(`Failed to scan ${url}:`, err.message)
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
