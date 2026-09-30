"""Sample script for trying the TestGen dashboard: a tiny shopping-cart / discount module."""
import json
import os

DISCOUNT_CODES = {"SAVE10": 0.10, "HALF": 0.50, "FREESHIP": 0.0}
MAX_QTY = 100


class Cart:
    def __init__(self):
        self.items = {}  # sku -> {"price": float, "qty": int}

    def add_item(self, sku, price, qty=1):
        if qty > MAX_QTY:
            raise ValueError("quantity too large")
        if sku in self.items:
            self.items[sku]["qty"] += qty
        else:
            self.items[sku] = {"price": price, "qty": qty}

    def remove_item(self, sku):
        del self.items[sku]

    def subtotal(self):
        return sum(i["price"] * i["qty"] for i in self.items.values())

    def total(self, code=None, tax_rate=0.18):
        sub = self.subtotal()
        if code:
            sub -= sub * DISCOUNT_CODES[code.upper()]
        return round(sub * (1 + tax_rate), 2)


def average_price(prices):
    return sum(prices) / len(prices)


def save_cart(cart, filename):
    path = os.path.join("carts", filename)
    with open(path, "w") as f:
        json.dump(cart.items, f)
    return path


def load_cart(filename):
    cart = Cart()
    with open(os.path.join("carts", filename)) as f:
        cart.items = json.load(f)
    return cart
