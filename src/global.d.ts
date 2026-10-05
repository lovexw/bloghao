// 主题 CSS 以纯文本导入（wrangler rules: Text）
declare module '*.css' {
  const css: string
  export default css
}

// schema.sql 以纯文本导入（仅演示站 bundle：wrangler.demo.jsonc rules，冷启动建表用）
declare module '*.sql' {
  const sql: string
  export default sql
}
