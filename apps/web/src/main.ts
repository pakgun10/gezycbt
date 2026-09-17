import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import App from "./App.vue";
import { createGezyRouter } from "./router";

createApp(App).use(createGezyRouter(createWebHistory())).mount("#app");
