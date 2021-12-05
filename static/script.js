// @ts-check

addEventListener("keypress", e => {
    switch (e.key) {
    case "a":
        document.getElementById("prev")?.click()
        break
    case "d":
        document.getElementById("next")?.click()
        break
    default:
        console.log(e.key)
        break
    }
})