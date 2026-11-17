// Sign-in screen, the settings sheet (your profile, password, sign out) and people management.
import { api } from "./api.js";
import { generatePassphrase } from "./passphrase.js";

const ELLIPSIS = String.fromCodePoint(0x2026);
const ROLE_LABELS = { member: "Member", editor: "Editor", admin: "Admin" };

const $ = (selector) => document.querySelector(selector);

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0][0];
  return letters.toUpperCase();
}

function shortDate(iso) {
  const date = new Date(iso);
  const options = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}

function setPasswordVisible(input, button, visible) {
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-pressed", String(visible));
  button.textContent = visible ? "Hide" : "Show";
}

export function setupAccount({ getSession, setSession, toast, onSignedIn, onSignedOut }) {
  const el = {
    signInView: $("#signInView"), signInForm: $("#signInForm"), signInError: $("#signInError"),
    signInSubmit: $("#signInSubmit"), signInCancel: $("#signInCancel"), signInShow: $("#signInShowPassword"),
    signInPassword: $("#signInPassword"),
    settingsDialog: $("#settingsDialog"), settingsInitials: $("#settingsInitials"), settingsName: $("#settingsName"),
    settingsMeta: $("#settingsMeta"), settingsAccess: $("#settingsAccess"),
    profileForm: $("#profileForm"), profileError: $("#profileError"), usernameField: $("#usernameField"),
    passwordPanel: $("#passwordPanel"), passwordSummary: $("#passwordSummary"), passwordForm: $("#passwordForm"),
    passwordIntro: $("#passwordIntro"), currentPasswordField: $("#currentPasswordField"), passwordError: $("#passwordError"),
    signOutButton: $("#signOutButton"), switchPersonButton: $("#switchPersonButton"),
    signOutEverywhereButton: $("#signOutEverywhereButton"),
    peopleSection: $("#peopleSection"), peopleList: $("#peopleList"), addPersonButton: $("#addPersonButton"),
    personDialog: $("#personDialog"), personForm: $("#personForm"), personTitle: $("#personDialogTitle"),
    personError: $("#personError"), personSubmit: $("#personSubmit"), personShow: $("#personShowPassword"),
    personPassword: $("#personPassword"), personPasswordLabel: $("#personPasswordLabel"),
    personPasswordHint: $("#personPasswordHint"), personRoleField: $("#personRoleField"),
    generatePassword: $("#generatePasswordButton"), deletePerson: $("#deletePersonButton"),
    togglePerson: $("#togglePersonButton"),
    shareDialog: $("#shareDialog"), shareTitle: $("#shareTitle"), shareText: $("#shareText"),
    shareIntro: $("#shareIntro"), shareLabel: $("#shareLabel"),
    shareStatus: $("#shareStatus"), copyShare: $("#copyShareButton"),
  };
  let people = [];
  let editing = null;

  function showSignIn({ canCancel = false, message = "" } = {}) {
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    document.body.classList.add("signing-in");
    el.signInView.hidden = false;
    el.signInForm.reset();
    el.signInCancel.hidden = !canCancel;
    el.signInError.textContent = message;
    setPasswordVisible(el.signInPassword, el.signInShow, false);
    requestAnimationFrame(() => el.signInForm.elements.username.focus());
  }

  function hideSignIn() {
    document.body.classList.remove("signing-in");
    el.signInView.hidden = true;
  }

  async function submitSignIn(event) {
    event.preventDefault();
    const form = new FormData(el.signInForm);
    el.signInError.textContent = "";
    el.signInSubmit.disabled = true;
    el.signInSubmit.textContent = `Signing in${ELLIPSIS}`;
    try {
      const session = await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      hideSignIn();
      el.signInForm.reset();
      await onSignedIn(session);
    } catch (error) {
      el.signInError.textContent = error.status === 0
        ? "Could not reach Recipe Box. Check your connection and try again."
        : error.message;
      el.signInPassword.focus();
      el.signInPassword.select();
    } finally {
      el.signInSubmit.disabled = false;
      el.signInSubmit.textContent = "Sign in";
    }
  }

  function renderSettings() {
    const { user, signedIn, homeNetwork } = getSession();
    if (!user) return;
    const actingAsOwner = homeNetwork && !signedIn;
    el.settingsInitials.textContent = initials(user.displayName);
    el.settingsName.textContent = user.displayName;
    el.settingsMeta.textContent = `@${user.username}, ${user.owner ? "owner" : ROLE_LABELS[user.role].toLowerCase()}`;
    el.settingsAccess.textContent = actingAsOwner
      ? "On your home network Recipe Box opens as the owner, without signing in."
      : `Signed in${homeNetwork ? " on the home network" : ""}.`;
    el.profileForm.elements.displayName.value = user.displayName;
    el.profileForm.elements.username.value = user.username;
    el.usernameField.hidden = user.role !== "admin";
    el.profileError.textContent = "";

    el.passwordSummary.textContent = user.hasPassword ? "Change password" : "Set a password";
    el.passwordIntro.textContent = user.hasPassword
      ? "Changing it signs you out on your other devices."
      : "You need one to sign in from outside your home network.";
    el.currentPasswordField.hidden = !user.hasPassword || actingAsOwner;
    el.passwordForm.elements.currentPassword.required = !el.currentPasswordField.hidden;
    el.passwordError.textContent = "";

    el.signOutButton.hidden = !signedIn;
    el.switchPersonButton.hidden = !actingAsOwner;
    el.signOutEverywhereButton.hidden = !user.hasPassword;
    el.signOutEverywhereButton.textContent = actingAsOwner ? "Sign out devices outside the home network" : "Sign out on every device";

    el.peopleSection.hidden = user.role !== "admin";
    if (user.role === "admin") loadPeople();
  }

  function openSettings() {
    renderSettings();
    if (!el.settingsDialog.open) el.settingsDialog.showModal();
  }

  async function submitProfile(event) {
    event.preventDefault();
    const form = new FormData(el.profileForm);
    const body = { displayName: form.get("displayName") };
    if (!el.usernameField.hidden) body.username = form.get("username");
    el.profileError.textContent = "";
    try {
      const { user } = await api("/api/me", { method: "PUT", body: JSON.stringify(body) });
      setSession({ ...getSession(), user });
      renderSettings();
      toast("Profile saved.");
    } catch (error) {
      el.profileError.textContent = error.message;
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const form = new FormData(el.passwordForm);
    el.passwordError.textContent = "";
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      el.passwordError.textContent = "The two new passwords do not match.";
      return;
    }
    const hadPassword = getSession().user.hasPassword;
    try {
      const { user } = await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.get("currentPassword") || "", newPassword: form.get("newPassword") }),
      });
      setSession({ ...getSession(), user });
      el.passwordForm.reset();
      el.passwordPanel.open = false;
      renderSettings();
      toast(hadPassword ? "Password changed. Your other devices were signed out." : "Password set. You can now sign in from outside your home network.");
    } catch (error) {
      el.passwordError.textContent = error.message;
    }
  }

  async function signOut() {
    try {
      const session = await api("/api/session", { method: "DELETE" });
      el.settingsDialog.close();
      await onSignedOut(session);
    } catch (error) {
      toast(error.message);
    }
  }

  async function signOutEverywhere() {
    const { signedIn, homeNetwork } = getSession();
    const actingAsOwner = homeNetwork && !signedIn;
    const question = actingAsOwner
      ? "Sign out every device that signed in from outside the home network?"
      : "Sign out on every device, this one included?";
    if (!confirm(question)) return;
    try {
      const session = await api("/api/sessions", { method: "DELETE" });
      if (actingAsOwner) {
        toast("Devices outside the home network were signed out.");
        return;
      }
      el.settingsDialog.close();
      await onSignedOut(session);
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadPeople() {
    try {
      const { users } = await api("/api/users");
      people = users;
      renderPeople();
    } catch (error) {
      const row = document.createElement("li");
      row.className = "person-row";
      row.textContent = error.message;
      el.peopleList.replaceChildren(row);
    }
  }

  function personStatus(person) {
    if (person.disabled) return "Sign-in turned off";
    if (!person.hasPassword) return person.owner ? "Owner, no password yet" : "No password yet";
    const last = person.lastSignInAt ? `last signed in ${shortDate(person.lastSignInAt)}` : "has not signed in yet";
    return person.owner ? `Owner, ${last}` : last.charAt(0).toUpperCase() + last.slice(1);
  }

  function renderPeople() {
    const me = getSession().user;
    el.peopleList.replaceChildren(...people.map((person) => {
      const row = document.createElement("li");
      row.className = `person-row${person.disabled ? " disabled" : ""}`;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = initials(person.displayName);
      const copy = document.createElement("div");
      copy.className = "person-copy";
      const name = document.createElement("strong");
      name.textContent = person.displayName;
      const meta = document.createElement("span");
      meta.textContent = `@${person.username}, ${ROLE_LABELS[person.role]}`;
      const status = document.createElement("small");
      status.textContent = personStatus(person);
      copy.append(name, meta, status);
      row.append(avatar, copy);
      if (person.id === me.id || (person.owner && !me.owner)) {
        // Only the owner changes the owner's account (in Your profile).
        const you = document.createElement("span");
        you.className = "person-you";
        you.textContent = person.id === me.id ? "You" : "Owner";
        row.append(you);
      } else {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "button button-quiet";
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", `Edit ${person.displayName}`);
        edit.addEventListener("click", () => openPersonDialog(person));
        row.append(edit);
      }
      return row;
    }));
  }

  function openPersonDialog(person = null) {
    editing = person;
    el.personForm.reset();
    el.personError.textContent = "";
    el.personTitle.textContent = person ? `Edit ${person.displayName}` : "Add a person";
    el.personSubmit.textContent = person ? "Save changes" : "Add person";
    const fields = el.personForm.elements;
    fields.displayName.value = person?.displayName || "";
    fields.username.value = person?.username || "";
    fields.role.value = person?.role || "member";
    fields.role.disabled = Boolean(person?.owner);
    el.personRoleField.title = person?.owner ? "The owner stays an admin." : "";
    el.personPasswordLabel.textContent = person ? "New password" : "Password";
    el.personPassword.required = !person;
    el.personPasswordHint.textContent = person
      ? "Leave empty to keep their password. A new one signs them out everywhere."
      : "At least 10 characters. Generate makes an easy one to type.";
    setPasswordVisible(el.personPassword, el.personShow, false);
    el.deletePerson.hidden = !person || person.owner;
    el.togglePerson.hidden = !person || person.owner;
    el.togglePerson.textContent = person?.disabled ? "Turn sign-in back on" : "Turn off sign-in";
    el.personDialog.showModal();
    requestAnimationFrame(() => fields.displayName.focus());
  }

  async function submitPerson(event) {
    event.preventDefault();
    const fields = el.personForm.elements;
    const password = fields.password.value;
    const body = { displayName: fields.displayName.value, username: fields.username.value };
    if (!fields.role.disabled) body.role = fields.role.value;
    if (!editing || password) body.password = password;
    el.personError.textContent = "";
    if ((!editing || password) && password.length < 10) {
      el.personError.textContent = "Passwords need at least 10 characters.";
      el.personPassword.focus();
      return;
    }
    el.personSubmit.disabled = true;
    try {
      const { user } = editing
        ? await api(`/api/users/${encodeURIComponent(editing.id)}`, { method: "PUT", body: JSON.stringify(body) })
        : await api("/api/users", { method: "POST", body: JSON.stringify(body) });
      el.personDialog.close();
      await loadPeople();
      if (password) showShare(user, password);
      else toast(`${user.displayName} saved.`);
    } catch (error) {
      el.personError.textContent = error.message;
    } finally {
      el.personSubmit.disabled = false;
    }
  }

  async function togglePerson() {
    if (!editing) return;
    const turningOff = !editing.disabled;
    if (turningOff && !confirm(`Turn off sign-in for ${editing.displayName}? They are signed out on every device.`)) return;
    try {
      const { user } = await api(`/api/users/${encodeURIComponent(editing.id)}`, { method: "PUT", body: JSON.stringify({ disabled: turningOff }) });
      el.personDialog.close();
      await loadPeople();
      toast(turningOff ? `${user.displayName} can no longer sign in.` : `${user.displayName} can sign in again.`);
    } catch (error) {
      el.personError.textContent = error.message;
    }
  }

  async function deletePerson() {
    if (!editing) return;
    const name = editing.displayName;
    if (!confirm(`Delete ${name}? Their journal, Kitchen Stock, favorites, meal plan and shopping list are deleted too. This cannot be undone.`)) return;
    try {
      await api(`/api/users/${encodeURIComponent(editing.id)}`, { method: "DELETE" });
      el.personDialog.close();
      await loadPeople();
      toast(`${name} was deleted.`);
    } catch (error) {
      el.personError.textContent = error.message;
    }
  }

  function showShare(user, password) {
    const lines = [`Recipe Box sign-in for ${user.displayName}`];
    if (!getSession().homeNetwork) lines.push(`Address: ${location.origin}`);
    lines.push(`Username: ${user.username}`, `Password: ${password}`);
    showText({
      title: `Send ${user.displayName} their sign-in`,
      intro: "Share these details with them. The password is not shown again; you can set a new one later.",
      label: "Sign-in details",
      text: lines.join("\n"),
    });
  }

  // A dialog with text to copy, for when the browser cannot share or use the clipboard.
  function showText({ title, intro, label, text, rows = 5 }) {
    el.shareTitle.textContent = title;
    el.shareIntro.textContent = intro;
    el.shareLabel.textContent = label;
    el.shareText.value = text;
    el.shareText.rows = rows;
    el.shareStatus.textContent = "";
    el.shareDialog.showModal();
  }

  async function copyShare() {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(el.shareText.value);
      el.shareStatus.textContent = "Copied.";
    } catch {
      el.shareText.focus();
      el.shareText.select();
      el.shareStatus.textContent = "Selected. Press Ctrl+C or Cmd+C to copy, or long-press it on a phone.";
    }
  }

  el.signInForm.addEventListener("submit", submitSignIn);
  el.signInShow.addEventListener("click", () => setPasswordVisible(el.signInPassword, el.signInShow, el.signInPassword.type === "password"));
  el.signInCancel.addEventListener("click", hideSignIn);
  el.profileForm.addEventListener("submit", submitProfile);
  el.passwordForm.addEventListener("submit", submitPassword);
  el.signOutButton.addEventListener("click", signOut);
  el.switchPersonButton.addEventListener("click", () => showSignIn({ canCancel: true }));
  el.signOutEverywhereButton.addEventListener("click", signOutEverywhere);
  el.addPersonButton.addEventListener("click", () => openPersonDialog());
  el.personForm.addEventListener("submit", submitPerson);
  el.personShow.addEventListener("click", () => setPasswordVisible(el.personPassword, el.personShow, el.personPassword.type === "password"));
  el.generatePassword.addEventListener("click", () => {
    el.personPassword.value = generatePassphrase();
    setPasswordVisible(el.personPassword, el.personShow, true);
    el.personPassword.focus();
  });
  el.deletePerson.addEventListener("click", deletePerson);
  el.togglePerson.addEventListener("click", togglePerson);
  el.copyShare.addEventListener("click", copyShare);
  el.shareDialog.addEventListener("close", () => {
    el.shareText.value = "";
    el.shareStatus.textContent = "";
  });

  return { showSignIn, hideSignIn, openSettings, renderSettings, showText };
}
