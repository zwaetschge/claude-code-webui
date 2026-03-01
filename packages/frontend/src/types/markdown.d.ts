// Type declarations for markdown plugins without type definitions

declare module 'remark-math' {
  import type { Plugin } from 'unified';
  const remarkMath: Plugin;
  export default remarkMath;
}

declare module 'rehype-katex' {
  import type { Plugin } from 'unified';
  const rehypeKatex: Plugin;
  export default rehypeKatex;
}
