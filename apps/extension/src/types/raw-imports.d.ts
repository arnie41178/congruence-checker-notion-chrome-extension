// Allow Vite ?raw imports to be typed as strings
declare module "*?raw" {
  const content: string;
  export default content;
}
