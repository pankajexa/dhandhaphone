# Reorder Point and Safety Stock

## The Reorder Formula

```
Reorder Point = (Average Daily Usage x Lead Time in Days) + Safety Stock
```

When your stock hits the reorder point, place a new order immediately.

## Safety Stock

```
Safety Stock = Average Daily Usage x Buffer Days
```

Buffer days account for supplier delays, demand spikes, and transport issues. Typical values:

| Scenario | Buffer Days |
|----------|-------------|
| Reliable local supplier (same city) | 2-3 days |
| Regional supplier (same state) | 5-7 days |
| Distant supplier (other state, import) | 10-15 days |
| Monsoon season (any supplier) | Add 3-5 extra days |
| Pre-festival period | Add 5-10 extra days |

## Example Calculations

### Example 1: Toor Dal at a Kirana Store
- Average daily sales: 5 kg
- Lead time (local wholesaler delivers in 2 days): 2 days
- Buffer: 3 days (reliable supplier)
- Safety stock: 5 x 3 = 15 kg
- **Reorder point: (5 x 2) + 15 = 25 kg**
- When stock hits 25 kg, order more

### Example 2: Cement at a Hardware Shop
- Average daily sales: 20 bags
- Lead time (distributor from next city): 5 days
- Buffer: 7 days (heavy, transport-dependent)
- Safety stock: 20 x 7 = 140 bags
- **Reorder point: (20 x 5) + 140 = 240 bags**

### Example 3: Mobile Phone Chargers (Electronics Shop)
- Average daily sales: 3 units
- Lead time (online wholesale order): 7 days
- Buffer: 5 days
- Safety stock: 3 x 5 = 15 units
- **Reorder point: (3 x 7) + 15 = 36 units**

## Adjustments for Indian Business Context

- **Festival season:** Increase reorder point by 50-100% for Diwali/Onam/Puja relevant items
- **Monsoon:** Add buffer days for transport delays, especially for goods shipped by road
- **Supplier holidays:** Account for supplier shutdowns during major festivals
- **Cash flow constraints:** If cash is tight, order smaller quantities more frequently instead of bulk
- **Seasonal items:** For items sold only in specific seasons, use seasonal daily usage rates, not annual averages

## Order Quantity

Once you hit the reorder point, how much to order?

**Simple approach for SMBs:**
```
Order Quantity = (Target Days of Stock x Daily Usage) - Current Stock
```

Most small shops target 15-30 days of stock for staples and 7-15 days for perishables.

**Bulk discount consideration:** If the supplier offers 5% off for double the quantity, only take it if the item will sell within its shelf life and you have the cash and storage space.
