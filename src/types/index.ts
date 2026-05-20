export interface PizzaOrder {
  name: string
  size: string
  base: string
  modifications: string
  sides: string
}

export interface User {
  id: string
  name: string
  emails: string[]
  balance: number
  defaultPizza: PizzaOrder
  currentPizza: PizzaOrder
  isPresent: boolean
  isSharing: boolean
  isAdmin?: boolean
  pizzaOverridden?: boolean
  createdAt: number
}

export interface AppState {
  nextOrdererId: string | null
}

export interface OrderSnapshot {
  timestamp: number
  totalAmount: number
  payerId: string
  userSnapshots: UserSnapshot[]
}

export interface UserSnapshot {
  userId: string
  balanceBefore: number
  pizzaBefore: PizzaOrder
  wasPresentBefore: boolean
}

export const EMPTY_PIZZA: PizzaOrder = {
  name: '',
  size: 'Small 9.5"',
  base: 'Italian Style',
  modifications: '',
  sides: ''
}

export const PIZZA_SIZES = ['Small 9.5"', 'Medium 11.5"', 'Large 13.5"']
export const PIZZA_BASES = ['Classic Crust', 'Stuffed Crust', 'Italian Style', 'Thin & Crispy', 'Double Decadence']
