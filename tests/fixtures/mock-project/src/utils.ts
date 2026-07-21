export function buttonHelper() {
  console.log('Button helper called');
}

export function unusedHelper() {
  console.log('Unused helper but imported in main.ts so it should be ALIVE');
}

export function deadHelper() {
  console.log('Dead helper, never imported anywhere!');
}
