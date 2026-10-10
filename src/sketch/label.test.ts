import { describe, expect, it } from 'vitest'
import { breakPoints } from './label'

describe('breakPoints', () => {
  it('breaks camelCase and PascalCase names between words', () => {
    expect(breakPoints('MeasurementInstrumentCalibration')).toEqual(['Measurement', 'Instrument', 'Calibration'])
    expect(breakPoints('hasTopping')).toEqual(['has', 'Topping'])
  })

  it('keeps acronyms together and splits before the next word', () => {
    expect(breakPoints('HTTPRequestHandler')).toEqual(['HTTP', 'Request', 'Handler'])
  })

  it('breaks after separators and before numbers', () => {
    expect(breakPoints('pump_station-unit/A')).toEqual(['pump_', 'station-', 'unit/', 'A'])
    expect(breakPoints('Valve2Way')).toEqual(['Valve', '2Way'])
  })

  it('leaves short and spaced labels alone', () => {
    expect(breakPoints('Pizza')).toEqual(['Pizza'])
    expect(breakPoints('Tomato Topping')).toEqual(['Tomato Topping'])
  })
})
