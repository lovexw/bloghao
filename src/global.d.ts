// 主题 CSS 以纯文本导入（wrangler rules: Text）
declare module '*.css' {
  const css: string
  export default css
}
