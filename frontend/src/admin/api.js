import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const ADMIN_API = BACKEND_URL ? `${BACKEND_URL}/api/admin` : "/api/admin";
const TOKEN_KEY = "pupu_admin_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

export async function adminLogin(username, password) {
  const { data } = await axios.post(`${ADMIN_API}/login`, { username, password });
  setToken(data.token);
  return data;
}

export async function fetchOverview() {
  const { data } = await axios.get(`${ADMIN_API}/overview`, { headers: authHeaders() });
  return data;
}

export async function sendControl(guild_id, action, value = null) {
  const { data } = await axios.post(
    `${ADMIN_API}/control`,
    { guild_id, action, value },
    { headers: authHeaders() }
  );
  return data;
}

export async function verifyToken() {
  await axios.get(`${ADMIN_API}/me`, { headers: authHeaders() });
  return true;
}
