// Code 128 (set B) barcodes as SVG bars, for item labels. Printable ASCII only.

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
]
const START_B = 104
const STOP = 106

/** Bar and space widths, in modules, for the text; null when a character can't be encoded. */
export function code128(text: string): number[] | null {
  const codes: number[] = [START_B]
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c < 32 || c > 126) return null
    codes.push(c - 32)
  }
  const check = codes.reduce((sum, c, i) => sum + c * (i === 0 ? 1 : i), 0) % 103
  codes.push(check, STOP)
  return codes.flatMap((c) => PATTERNS[c].split("").map(Number))
}

/** SVG path for the bars at the given module width and height. */
export function code128Path(text: string, module = 1, height = 40) {
  const widths = code128(text)
  if (!widths) return null
  let x = 10 * module
  let d = ""
  widths.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x} 0h${w * module}v${height}h-${w * module}z`
    x += w * module
  })
  return { d, width: x + 10 * module, height }
}
