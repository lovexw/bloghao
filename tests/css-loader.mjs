/** Node 测试用：把 .css 顶替成空字符串模块（wrangler 部署有 Text rule，tsx 测试没有），
 *  让 tests/themes.test.ts 能 import 五套主题模块。链上 next() 不干扰 tsx 自身的 TS loader */
export async function load(url, context, next) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default ""', shortCircuit: true }
  }
  return next(url, context)
}
