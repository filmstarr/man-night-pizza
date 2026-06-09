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
  fcmTokens?: string[]
  chatNotificationsEnabled?: boolean
  lastReadAt?: number
  createdAt: number
}

export interface ChatMessage {
  id: string
  userId: string
  text: string
  createdAt: number
  reactions?: Record<string, string[]>  // emoji → [userId, ...]
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
  size: 'Small',
  base: 'Italian Style',
  modifications: '',
  sides: ''
}

export const PIZZA_SIZES = ['Small', 'Medium', 'Large']
export const PIZZA_BASES = ['Classic Crust', 'Stuffed Crust', 'Italian Style', 'Thin & Crispy', 'Double Decadence']
