/**
 * `xml-namespace-loader` exports the markup as a string after registering the
 * modules its custom namespaces refer to.
 */
declare module '*.xml' {
  const markup: string;
  export default markup;
}
