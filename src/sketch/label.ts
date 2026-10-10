/**
 * Splits a class label into pieces between which a line may break, besides spaces:
 * camelCase humps, digits after letters, and after `_`, `-`, `/` or `.`.
 * The view puts a <wbr> between pieces; a piece still too wide breaks anywhere (CSS).
 */
export function breakPoints(label: string): string[] {
  return label.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])|(?<=[_\-/.])(?=\S)/)
}
