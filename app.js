// ==========================================
// MASTER DATABASE & SHARED UTILITIES
// Table: inventoryStock
// ==========================================

var STORAGE_KEY = "edushelf_inventory_v2";

var defaultInventory = [
  { product_code: "BP-BLK-001", product_name: "Ballpen (Black)", category: "Writing Tool", quantity: 150, unit_price: "10.00", location: "Shelf A1", threshold: 15, status: "With Stock" },
  { product_code: "BP-RED-002", product_name: "Ballpen (Red)", category: "Writing Tool", quantity: 8, unit_price: "12.50", location: "Shelf A1", threshold: 10, status: "Low Stock" },
  { product_code: "YP-STD-003", product_name: "Yellow Pad (100 sheets)", category: "Stationery", quantity: 45, unit_price: "78.50", location: "Shelf B2", threshold: 10, status: "With Stock" },
  { product_code: "BP-LNG-004", product_name: "Bond Paper (Long, Ream)", category: "Stationery", quantity: 20, unit_price: "240.00", location: "Shelf B3", threshold: 5, status: "With Stock" },
  { product_code: "BP-SHT-005", product_name: "Bond Paper (Short, Ream)", category: "Stationery", quantity: 3, unit_price: "210.00", location: "Shelf B3", threshold: 5, status: "Low Stock" },
  { product_code: "MRK-PER-006", product_name: "Permanent Marker (Black)", category: "Writing Tool", quantity: 0, unit_price: "35.00", location: "Shelf A2", threshold: 10, status: "Out of Stock" },
  { product_code: "MRK-WBO-007", product_name: "White Board Marker (Blue)", category: "Writing Tool", quantity: 30, unit_price: "38.00", location: "Shelf A2", threshold: 10, status: "With Stock" },
  { product_code: "INK-BLK-008", product_name: "Printer Ink (Black, 70ml)", category: "Printer Supplies", quantity: 12, unit_price: "350.00", location: "Cabinet C1", threshold: 5, status: "With Stock" },
  { product_code: "INK-CYN-0009", product_name: "Printer Ink (Cyan, 70ml)", category: "Printer Supplies", quantity: 4, unit_price: "350.00", location: "Cabinet C1", threshold: 5, status: "Low Stock" },
  { product_code: "INK-YLW-010", product_name: "Printer Ink (Yellow, 70ml)", category: "Printer Supplies", quantity: 0, unit_price: "350.00", location: "Cabinet C1", threshold: 5, status: "Out of Stock" },
  { product_code: "INK-MAG-011", product_name: "Printer Ink (Magenta, 70ml)", category: "Printer Supplies", quantity: 10, unit_price: "350.00", location: "Cabinet C1", threshold: 5, status: "With Stock" }
];

function formatTimestamp() {
  return new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCurrentActor() {
  return localStorage.getItem("userName") || "Juan Dela Cruz";
}

function calculateStockStatus(quantity, threshold) {
  var numericQty = parseInt(quantity, 10);
  var numericThreshold = parseInt(threshold, 10) || 5;
  if (numericQty <= 0) return "Out of Stock";
  if (numericQty <= numericThreshold) return "Low Stock";
  return "With Stock";
}

function getStatusBadgeClass(status) {
  if (status === "Out of Stock") return "bg-rose-500/15 text-rose-700";
  if (status === "Low Stock") return "bg-amber-500/15 text-amber-700";
  return "bg-[#14AE5C]/10 text-[#14AE5C]";
}

function initDatabase() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    var now = formatTimestamp();
    var seeded = defaultInventory.map(function (item) {
      var threshold = item.threshold ? parseInt(item.threshold, 10) : 5;
      var status = calculateStockStatus(item.quantity, threshold);
      return {
        product_code: item.product_code,
        product_name: item.product_name,
        category: item.category,
        quantity: parseInt(item.quantity, 10),
        unit_price: parseFloat(item.unit_price).toFixed(2),
        location: item.location,
        threshold: threshold,
        status: status,
        updatedAt: now,
        history: [
          {
            date: now,
            action: "Initial Record",
            details: "Opening stock recorded at " + item.quantity + " units",
            user: "System"
          }
        ]
      };
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  }
}

// READ ALL
function getFullInventory() {
  initDatabase();
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

function saveFullInventory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// READ ONE
function getItemByCode(productCode) {
  if (!productCode) return null;
  var items = getFullInventory();
  return items.find(function (item) {
    return item.product_code.toLowerCase() === productCode.toLowerCase();
  }) || null;
}

// CREATE
function addItem(itemData) {
  var items = getFullInventory();
  var code = itemData.product_code.trim();
  var exists = items.some(function (item) {
    return item.product_code.toLowerCase() === code.toLowerCase();
  });

  if (exists) {
    return { success: false, message: "Product Code (" + code + ") already exists." };
  }

  var now = formatTimestamp();
  var quantity = parseInt(itemData.quantity, 10);
  var threshold = parseInt(itemData.threshold, 10) || 5;
  var unitPrice = parseFloat(itemData.unit_price).toFixed(2);
  var status = calculateStockStatus(quantity, threshold);

  var newRecord = {
    product_code: code,
    product_name: itemData.product_name.trim(),
    category: itemData.category,
    quantity: quantity,
    unit_price: unitPrice,
    location: itemData.location.trim(),
    threshold: threshold,
    status: status,
    updatedAt: now,
    history: [
      {
        date: now,
        action: "Item Created",
        details: "Added to catalog with " + quantity + " units at ₱" + unitPrice + " each",
        user: getCurrentActor()
      }
    ]
  };

  items.push(newRecord);
  saveFullInventory(items);
  return { success: true, item: newRecord };
}

// UPDATE
function updateItem(originalCode, updatedData) {
  var items = getFullInventory();
  var index = items.findIndex(function (item) {
    return item.product_code.toLowerCase() === originalCode.toLowerCase();
  });

  if (index === -1) {
    return { success: false, message: "Item not found." };
  }

  var newCode = updatedData.product_code.trim();
  if (newCode.toLowerCase() !== originalCode.toLowerCase()) {
    var duplicate = items.some(function (item) {
      return item.product_code.toLowerCase() === newCode.toLowerCase();
    });
    if (duplicate) {
      return { success: false, message: "Product Code (" + newCode + ") is already in use." };
    }
  }

  var current = items[index];
  var newQty = parseInt(updatedData.quantity, 10);
  var newPrice = parseFloat(updatedData.unit_price).toFixed(2);
  var newThreshold = parseInt(updatedData.threshold, 10) || 5;
  var newStatus = calculateStockStatus(newQty, newThreshold);
  var now = formatTimestamp();

  var changes = [];
  if (current.product_code !== newCode) changes.push("SKU: " + current.product_code + " → " + newCode);
  if (current.product_name !== updatedData.product_name.trim()) changes.push("Name updated");
  if (current.category !== updatedData.category) changes.push("Category: " + current.category + " → " + updatedData.category);
  if (current.quantity !== newQty) changes.push("Qty: " + current.quantity + " → " + newQty);
  if (current.unit_price !== newPrice) changes.push("Price: ₱" + current.unit_price + " → ₱" + newPrice);
  if (current.location !== updatedData.location.trim()) changes.push("Location: " + current.location + " → " + updatedData.location.trim());
  if (current.threshold !== newThreshold) changes.push("Min Threshold: " + current.threshold + " → " + newThreshold);

  var historyList = current.history ? current.history.slice() : [];
  if (changes.length > 0) {
    historyList.unshift({
      date: now,
      action: "Record Edited",
      details: changes.join(" • "),
      user: getCurrentActor()
    });
  }

  items[index] = {
    product_code: newCode,
    product_name: updatedData.product_name.trim(),
    category: updatedData.category,
    quantity: newQty,
    unit_price: newPrice,
    location: updatedData.location.trim(),
    threshold: newThreshold,
    status: newStatus,
    updatedAt: now,
    history: historyList
  };

  saveFullInventory(items);
  return { success: true, item: items[index] };
}

// DELETE
function deleteItem(productCode) {
  var items = getFullInventory();
  var filtered = items.filter(function (item) {
    return item.product_code.toLowerCase() !== productCode.toLowerCase();
  });
  saveFullInventory(filtered);
  return true;
}

function loadUserProfile() {
  if (localStorage.getItem("userName")) {
    var nameEl = document.getElementById("sidebarProfileName");
    var roleEl = document.getElementById("sidebarProfileRole");
    if (nameEl) nameEl.innerText = localStorage.getItem("userName");
    if (roleEl) roleEl.innerText = localStorage.getItem("userRole") || "Administrator";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  initDatabase();
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
  loadUserProfile();
});