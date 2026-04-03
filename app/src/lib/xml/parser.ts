// Deluge XML <-> JSON conversion utilities.
// Ported from downrush/viewScore/src/JsonXMLUtils.js
//
// Two main operations:
//   parsePreset()     — XML string -> structured JSON (with DRObject instances)
//   serializePreset() — structured JSON -> XML string

import { keyOrderTab, heteroArrays, dontEncodeAsAttributes } from './schema'
import { DRObject, nameToClassTab } from './models'

// Properties that are never written to XML or JSON serialization output.
export const doNotSerialize = new Set(['uniqueId', '_class', '_type'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArrayLike(val: unknown): val is unknown[] {
  if (val === null || val === undefined) return false
  return Array.isArray(val)
}

function isObject(val: unknown): val is Record<string, unknown> {
  if (val === null || val === undefined) return false
  return typeof val === 'function' || typeof val === 'object'
}

function gentabs(d: number): string {
  let str = ''
  for (let i = 0; i < d; ++i) str += '\t'
  return str
}

/** Escape special characters for safe inclusion in XML attribute values. */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------------------------------------------------------------------------
// XML -> JSON
// ---------------------------------------------------------------------------

/**
 * Convert an XML DOM element (or text node) to a JSON-like structure.
 * Attributes are flattened directly onto the object (no @attributes wrapper).
 * Elements listed in `heteroArrays` produce arrays of typed DRObject instances.
 */
export function xml3ToJson(xml: Element | ChildNode, fill?: Record<string, unknown>): unknown {
  let obj: any = fill ? fill : {}

  if (xml.nodeType === 1) {
    // Element node — flatten attributes
    const el = xml as Element
    if (el.attributes.length > 0) {
      for (let j = 0; j < el.attributes.length; j += 1) {
        const attribute = el.attributes.item(j)!
        obj[attribute.nodeName] = attribute.nodeValue
      }
    }
  } else if (xml.nodeType === 3) {
    // Text node
    return xml.nodeValue
  }

  const makeArray = heteroArrays.has(xml.nodeName)
  if (makeArray) {
    obj = []
  }

  // Single text child — return its value directly
  if (xml.hasChildNodes() && xml.childNodes.length === 1 && xml.childNodes[0].nodeType === 3) {
    return xml.childNodes[0].nodeValue
  } else if (xml.hasChildNodes()) {
    for (let i = 0; i < xml.childNodes.length; i += 1) {
      const item = xml.childNodes.item(i)!
      const nodeName = item.nodeName
      if (item.nodeType === 3) continue // skip text nodes

      const classToMake = nameToClassTab[nodeName]
      let childToFill: Record<string, unknown> | undefined
      if (classToMake) {
        childToFill = new classToMake()
      }

      if (makeArray) {
        ;(obj as unknown[]).push(xml3ToJson(item, childToFill))
      } else if (typeof obj[nodeName] === 'undefined') {
        obj[nodeName] = xml3ToJson(item, childToFill)
      } else {
        // Duplicate element name — promote to array
        if (typeof obj[nodeName].push === 'undefined') {
          const old = obj[nodeName]
          obj[nodeName] = []
          obj[nodeName].push(old)
        }
        obj[nodeName].push(xml3ToJson(item, childToFill))
      }
    }
  }
  return obj
}

// ---------------------------------------------------------------------------
// JSON -> XML
// ---------------------------------------------------------------------------

/**
 * Convert a JSON value back to an XML string.
 *
 * Scalars become XML attributes on their parent element.
 * Objects / arrays become child elements, ordered according to `keyOrderTab`.
 * heteroArrays produce mixed-type children keyed by `xmlName()`.
 */
export function jsonToXML3(kv: string, j: unknown, d: number): string {
  if (!isObject(j)) {
    return gentabs(d) + '<' + kv + '>' + j + '</' + kv + '>\n'
  }

  let insides = ''

  // Separate scalars (-> attributes) from objects/arrays (-> child elements)
  const attrList: string[] = []
  const keySet = new Set<string>()

  for (const ek in j) {
    if (!doNotSerialize.has(ek) && Object.prototype.hasOwnProperty.call(j, ek)) {
      const v = (j as Record<string, unknown>)[ek]
      if (!isObject(v)) {
        if (!dontEncodeAsAttributes.has(ek)) attrList.push(ek)
      } else {
        keySet.add(ek)
      }
    }
  }

  // Build attribute string
  let atStr = ''
  for (let ix = 0; ix < attrList.length; ++ix) {
    const ak = attrList[ix]
    const v = String((j as Record<string, unknown>)[ak]).trim()
    if (ix > 0) {
      atStr += '\n' + gentabs(d + 1)
    } else {
      atStr += ' '
    }
    atStr += ak + '="' + xmlEscape(v) + '"'
  }

  // Determine child element order from keyOrderTab
  const keyTab = keyOrderTab[kv]
  const keyOrder: string[] = []

  if (keyTab) {
    for (let ktx = 0; ktx < keyTab.length; ++ktx) {
      const nkv = keyTab[ktx]
      if (keySet.has(nkv)) {
        keyOrder.push(nkv)
        keySet.delete(nkv)
      }
    }
    // Append any keys not in the ordering table
    if (keySet.size > 0) {
      for (const sk of keySet.keys()) {
        keyOrder.push(sk)
        console.warn('Missing key in keyOrderTab: ' + sk + ' in: ' + kv)
      }
    }
  } else {
    // No ordering table entry — iterate the set as-is
    for (const ek of keySet) {
      keyOrder.push(ek)
    }
  }

  // Emit child elements
  for (let i = 0; i < keyOrder.length; ++i) {
    const kvo = keyOrder[i]
    const v = (j as Record<string, unknown>)[kvo]
    if (v === undefined) continue

    if (heteroArrays.has(kvo)) {
      // Mixed-type array: children use their own xmlName as the tag
      insides += gentabs(d) + '<' + kvo + '>\n'
      const arr = v as unknown[]
      for (let n = 0; n < arr.length; ++n) {
        const ao = arr[n]
        if (!(ao instanceof DRObject)) continue
        const hkv = ao.xmlName()
        insides += jsonToXML3(hkv, ao, d + 1)
      }
      insides += gentabs(d + 1) + '</' + kvo + '>\n'
    } else if (isArrayLike(v)) {
      // Homogeneous array: repeat the same tag for each entry
      for (let k = 0; k < v.length; ++k) {
        insides += jsonToXML3(kvo, v[k], d + 1)
      }
    } else if (isObject(v)) {
      insides += jsonToXML3(kvo, v, d + 1)
    } else {
      // Scalar that ended up in child keys (shouldn't normally happen)
      console.warn('k/v pair should not appear here: ' + kvo + ' ' + v)
    }
  }

  let str = gentabs(d) + '<' + kv + atStr
  if (insides.length > 0) {
    str += '>\n' + insides + gentabs(d) + '</' + kv + '>\n'
  } else {
    str += '/>\n'
  }
  return str
}

// ---------------------------------------------------------------------------
// High-level API
// ---------------------------------------------------------------------------

/**
 * Parse a Deluge XML preset string into a structured JSON object.
 * Returns the root element name and the parsed data tree.
 */
export function parsePreset(xmlString: string): { rootName: string; data: Record<string, unknown> } {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')
  const root = doc.documentElement
  const rootName = root.nodeName
  const data = xml3ToJson(root) as Record<string, unknown>
  return { rootName, data }
}

/**
 * Serialize a structured JSON object back to a Deluge XML string.
 * Produces an XML declaration header followed by the element tree.
 */
export function serializePreset(rootName: string, data: Record<string, unknown>): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + jsonToXML3(rootName, data, 0)
}
