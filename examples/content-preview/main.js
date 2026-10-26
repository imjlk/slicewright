import { applyAssembly, assembly } from './assembly.js';

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
  korean: {
    title: '속삭이는 숲 너머에서 길을 잃은 별에게 돌아갈 집을 알려 주세요',
    body: '가을 축제가 다가오지만 등불지기들은 아직 돌아오지 않았어요. 오래된 물레방앗간을 지나 이끼 낀 다리를 건너면 가장 오래된 참나무가 있는 공터에 도착할 거예요. 여분의 등불을 챙기고, 길에서 만난 여행자에게 따뜻한 빵을 나누어 주세요. 강을 지키는 친구에게 어느 길이 안전한지 물어보는 것도 잊지 마세요. 모두가 집으로 돌아오면 길드는 광장에 불을 밝히고 여러분의 친절에 관한 이야기를 들려줄 거예요.',
  },
};

const composition = document.querySelector('.composition');
const width = document.querySelector('#panel-width');
const scenario = document.querySelector('#scenario');
const status = document.querySelector('#quest-status');
const largeText = document.querySelector('#large-text');
width.min = assembly.body.minWidth;
width.max = assembly.body.maxWidth;
width.value = assembly.body.width;
function layout() {
  applyAssembly(composition, { ...assembly, body: { ...assembly.body, width: Number(width.value) } });
}
function update() {
  layout();
  composition.classList.toggle('large-text', largeText.checked);
  composition.lang = scenario.value === 'korean' ? 'ko' : 'en';
  document.querySelector('#width-value').value = `${width.value} px (fits available space)`;
  const content = scenarios[scenario.value];
  document.querySelector('#quest-title').textContent = content.title;
  document.querySelector('#quest-copy').textContent = content.body;
  status.textContent = 'Choose your next adventure.';
}
width.addEventListener('input', update);
scenario.addEventListener('change', update);
largeText.addEventListener('change', update);
window.addEventListener('resize', layout);
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
