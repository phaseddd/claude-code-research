import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// 仓库根（本配置位于 demos/insights-pipeline/）
const repoRoot = path.resolve(import.meta.dirname, '../..')

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

// dev 专用：把 /analysis、/workflow 等仓库根目录映射到本地文件。
// 序章的"配套知识页"链接（../../analysis/...）在 dev server 下按 URL 解析
// 会落到 /analysis/...（demo 根内不存在）—— 由本中间件接住；
// 部署到 GitHub Pages 仓库根时，相对路径 ../../analysis/... 天然正确，无需本插件。
function serveRepoDir(prefix) {
  return {
    name: `serve-repo-${prefix.slice(1)}`,
    configureServer(server) {
      server.middlewares.use(prefix, async (req, res, next) => {
        try {
          const rel = decodeURIComponent((req.url || '/').split('?')[0])
          const file = path.join(repoRoot, prefix, rel)
          const content = await readFile(file)
          res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
          res.end(content)
        } catch {
          next()
        }
      })
    },
  }
}

// 纯静态单页 demo，无框架；base 用相对路径，便于 GitHub Pages 子目录部署
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  plugins: [serveRepoDir('/analysis'), serveRepoDir('/workflow')],
  server: {
    watch: {
      // build 产物（npm run build 写 dist/）不参与 dev watch：
      // 否则 dev 会话中每次构建都触发 full-reload 打断页面
      ignored: ['**/dist/**', '**/.vision/**'],
      // .vision/ 同理（截图/录屏素材目录）：chrome-devtools MCP 录屏写 webm
      // 到 .vision/ 时若被 watch，full-reload 会打断正在录制的页面（实测）
    },
  },
})
