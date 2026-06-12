Component({
  properties: {
    dish: Object,
    qty: { type: Number, value: 0 },
    liked: Boolean,
  },
  methods: {
    onLike() { this.triggerEvent('like', { dish: this.data.dish }) },
    onQty(e) { this.triggerEvent('qty', { dish: this.data.dish, qty: e.detail.value }) },
  },
})
