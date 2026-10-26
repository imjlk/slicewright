const scenarios = {
  short: {
    title: 'A light in the old wood',
    body: 'The lantern keeper has lost her way. Follow the fireflies beyond the mill and bring her home before supper.',
  },
  long: {
    title: 'A promise to the lantern keepers beyond the whispering woods',
    body: 'The autumn festival is almost here, but the lantern keepers have not returned from their journey. Follow the fireflies past the old mill, over the mossy bridge, and into the clearing where the oldest oak stands. Bring a spare lantern, share your bread with any travelers you meet, and ask the river watcher which path is safe. When everyone is home, the guild will light the square and tell the story of your kindness.',
  },
  unbroken: {
    title: 'LanternKeepersBeyondTheWhisperingWoodsAndTheForgottenRiverCrossing',
    body: 'Find the traveler named OakleafGuildMessengerWithAnUnexpectedlyLongUnbrokenName and deliver the invitation. Long names must wrap inside the content region too.',
  },
};

const composition = document.querySelector('.composition');
const width = document.querySelector('#panel-width');
const scenario = document.querySelector('#scenario');
const status = document.querySelector('#quest-status');
function update() {
  composition.style.setProperty('--panel-width', `${width.value}px`);
  document.querySelector('#width-value').value = `${width.value} px (fits available space)`;
  const content = scenarios[scenario.value];
  document.querySelector('#quest-title').textContent = content.title;
  document.querySelector('#quest-copy').textContent = content.body;
  status.textContent = 'Choose your next adventure.';
}
width.addEventListener('input', update);
scenario.addEventListener('change', update);
document.querySelector('#guides').addEventListener('change', (event) => {
  composition.classList.toggle('show-guides', event.target.checked);
});
document.querySelector('#accept').addEventListener('click', () => {
  status.textContent = 'Quest accepted. Your adventure begins!';
});
document.querySelector('#later').addEventListener('click', () => {
  status.textContent = 'The guild will keep a lantern lit for you.';
});
update();
