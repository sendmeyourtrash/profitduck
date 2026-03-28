"use client";

import AliasManager from "./AliasManager";

export default function MenuItemAliasesPanel() {
  return (
    <AliasManager
      config={{
        apiEndpoint: "/api/menu-item-aliases",
        entityLabel: "Item",
        patternPlaceholder: "e.g. Old Item Name",
        displayPlaceholder: "e.g. Current Name",
        ignoreFieldName: "itemName",
      }}
    />
  );
}
