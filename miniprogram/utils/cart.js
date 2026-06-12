function getCart() { return getApp().globalData.cart }

function setQty(dish, qty) {
  const cart = getCart()
  const dishId = dish._id || dish.dishId
  const idx = cart.findIndex((i) => i.dishId === dishId)
  if (qty <= 0) { if (idx >= 0) cart.splice(idx, 1); return }
  if (idx >= 0) cart[idx].qty = qty
  else cart.push({ dishId, name: dish.name, qty, note: '' })
}

function setNote(dishId, note) {
  const item = getCart().find((i) => i.dishId === dishId)
  if (item) item.note = note
}

function clearCart() { getApp().globalData.cart = [] }
function cartCount() { return getCart().reduce((s, i) => s + i.qty, 0) }
function qtyMap() { const m = {}; for (const i of getCart()) m[i.dishId] = i.qty; return m }

module.exports = { getCart, setQty, setNote, clearCart, cartCount, qtyMap }
