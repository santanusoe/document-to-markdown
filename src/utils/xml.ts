export function parseXml(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.querySelector('parsererror');
  if (error) throw new Error(`Invalid XML: ${error.textContent?.trim() ?? 'unknown parser error'}`);
  return document;
}

export function localElements(root: ParentNode, localName: string): Element[] {
  const searchable = root as ParentNode & {
    getElementsByTagNameNS(namespace: string, qualifiedName: string): HTMLCollectionOf<Element>;
  };
  return Array.from(searchable.getElementsByTagNameNS('*', localName));
}

export function firstLocal(root: ParentNode, localName: string): Element | undefined {
  return localElements(root, localName)[0];
}

export function directLocal(root: ParentNode, localName: string): Element[] {
  return Array.from(root.children ?? []).filter((child) => child.localName === localName);
}

export function attrLocal(element: Element, localName: string): string | undefined {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName) return attribute.value;
  }
  return undefined;
}

export function textOf(root: ParentNode, localName = 't'): string {
  return localElements(root, localName)
    .map((element) => element.textContent ?? '')
    .join('');
}

export function naturalSort(paths: string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
