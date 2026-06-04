import type { PizzaOrder } from '../types'
import { PIZZA_SIZES, PIZZA_BASES } from '../types'

interface Props {
  pizza: PizzaOrder
  onChange: (pizza: PizzaOrder) => void
  compact?: boolean
  showErrors?: boolean
}

export function PizzaEditor({ pizza, onChange, compact = false, showErrors = false }: Props) {
  const set = (field: keyof PizzaOrder, value: string) =>
    onChange({ ...pizza, [field]: value })

  const inputClass = 'w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500'
  const selectClass = inputClass
  const nameInvalid = showErrors && !pizza.name.trim()

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-1.5 text-sm">
        <input
          className={nameInvalid ? `${inputClass} border-red-500` : inputClass}
          placeholder="Pizza name *"
          value={pizza.name}
          onChange={e => set('name', e.target.value)}
        />
        <select className={selectClass} value={pizza.size} onChange={e => set('size', e.target.value)}>
          {PIZZA_SIZES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className={selectClass} value={pizza.base} onChange={e => set('base', e.target.value)}>
          {PIZZA_BASES.map(b => <option key={b}>{b}</option>)}
        </select>
        <input
          className={inputClass}
          placeholder="Dip"
          value={pizza.sides}
          onChange={e => set('sides', e.target.value)}
        />
        <input
          className={`${inputClass} col-span-2`}
          placeholder="Modifications (e.g. +extra cheese, -onions)"
          value={pizza.modifications}
          onChange={e => set('modifications', e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Pizza <span className="text-red-500">*</span>
          </label>
          <input
            className={nameInvalid ? `${inputClass} border-red-500` : inputClass}
            placeholder="e.g. Pepperoni, Margherita"
            value={pizza.name}
            onChange={e => set('name', e.target.value)}
          />
          {nameInvalid && <p className="text-red-500 text-xs mt-0.5">Pizza name is required.</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Size</label>
          <select className={selectClass} value={pizza.size} onChange={e => set('size', e.target.value)}>
            {PIZZA_SIZES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Base</label>
          <select className={selectClass} value={pizza.base} onChange={e => set('base', e.target.value)}>
            {PIZZA_BASES.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Dip</label>
          <input
            className={inputClass}
            placeholder="e.g. garlic, BBQ"
            value={pizza.sides}
            onChange={e => set('sides', e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Modifications</label>
        <input
          className={inputClass}
          placeholder="e.g. Extra cheese, no onions"
          value={pizza.modifications}
          onChange={e => set('modifications', e.target.value)}
        />
      </div>
    </div>
  )
}
