declare module 'feather-icons' {
  interface FeatherIcon {
    toSvg(attrs?: Record<string, string | number>): string;
  }
  interface FeatherApi {
    icons: Record<string, FeatherIcon>;
  }
  const feather: FeatherApi;
  export default feather;
}
