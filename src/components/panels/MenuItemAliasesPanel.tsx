"use client";

import AliasManager from "./AliasManager";

export default function MenuItemAliasesPanel() {
  return (
    <AliasManager
      config={{
        apiEndpoint: "/api/menu-item-aliases",
        entityLabel: "Item",
        patternPlaceholder: "e.g. Mushroom Crêpe",
        displayPlaceholder: "e.g. Fun Guy",
        ignoreFieldName: "itemName",
      }}
    />
  );
}
