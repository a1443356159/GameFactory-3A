import { describe, it, expect } from 'vitest';
import { GGGame, ACTION_SECONDS } from '../rules.js';
import { BotController } from '../bots.js';
function game(n = 4) { const g = new GGGame(); g.start(Array.from({length:n},(_,i)=>`玩家${i}`)); return g; }
function round(g, hands) {
  hands.forEach((hand,i)=>{if(g.getState().players[i].alive) expect(g.invoke({type:'pick',actor:`p${i}`,hand}).ok).toBe(true);});
  g.update(1.3);
}
const action = (g,actor,type,target) => g.invoke({actor,type,target});
function fixture(players) {
  const g=game(players.length);g.state.phase='action';players.forEach((p,i)=>Object.assign(g.state.players[i],p));return g;
}
const player=(g,id=0)=>g.getState().players[id];

describe('GGgame simultaneous timed actions',()=>{
  it('starts at home with one armor, no knife and dynamic rosters',()=>{
    const s=game(40).getState();expect(s.players).toHaveLength(40);
    for(const p of s.players)expect([p.location,p.armor,p.knife,p.active,p.queue.length]).toEqual([p.home,1,false,null,0]);
  });
  it('keeps picks secret until all living players submit',()=>{
    const g=game();action(g,'p1','pick');g.invoke({type:'pick',actor:'p1',hand:'paper'});
    expect(player(g,1)).toMatchObject({picked:true,hand:null});expect(g.invoke({type:'pick',actor:'p1',hand:'rock'}).ok).toBe(false);
  });
  it('all players replay on one-hand and three-hand ties',()=>{
    const g=game(3);round(g,['rock','rock','rock']);round(g,['rock','paper','scissors']);
    expect(g.getState()).toMatchObject({phase:'rps',attempt:3});expect(g.getState().players.every(p=>!p.picked&&p.steps===0)).toBe(true);
  });
  it('each winner receives number of losers, even a minority winner',()=>{
    const g=game();round(g,['rock','rock','scissors','scissors']);expect(g.getState().players.map(p=>p.steps)).toEqual([2,2,0,0]);
    const h=game();round(h,['paper','rock','rock','rock']);expect(h.getState().players.map(p=>p.steps)).toEqual([3,0,0,0]);
  });
  it('wearing and taking a knife settle after 1s and do not block other players',()=>{
    const g=fixture([{steps:2},{steps:2},{}]);action(g,'p0','knife');action(g,'p1','wear');
    expect(player(g).knife).toBe(false);expect(player(g,1).armor).toBe(1);
    g.update(.999);expect(player(g).knife).toBe(false);g.update(.001);
    expect(player(g).knife).toBe(true);expect(player(g,1).armor).toBe(2);
    expect(action(g,'p0','wear').ok).toBe(true); // No extra cooldown.
  });
  it('locks only the actor, reserves queued steps, and executes FIFO without overlap',()=>{
    const g=fixture([{steps:3},{},{}]);action(g,'p0','knife');action(g,'p0','wear');action(g,'p0','move','p1');
    expect(player(g)).toMatchObject({steps:0,knife:false,armor:1,location:'p0'});expect(player(g).queue.map(j=>j.type)).toEqual(['wear','move']);
    expect(action(g,'p0','wear').ok).toBe(false);g.update(1);
    expect(player(g)).toMatchObject({knife:true,armor:1,active:{type:'wear',startedAt:1,endsAt:2}});
    g.update(1);expect(player(g)).toMatchObject({armor:2,location:null,active:{type:'move',startedAt:2,endsAt:4}});
    g.update(2);expect(player(g)).toMatchObject({location:'p1',active:null,queue:[]});
  });
  it('movement goes outdoors immediately and reaches any destination after 2s',()=>{
    const g=fixture([{steps:2},{steps:1},{}]);action(g,'p0','move','p2');action(g,'p1','move','p2');
    expect(player(g).location).toBeNull();expect(player(g,1).location).toBeNull();
    expect(action(g,'p0','strip','p1').ok).toBe(false);g.update(1.999);expect(player(g).location).toBeNull();
    g.update(.001);expect(player(g).location).toBe('p2');expect(player(g,1).location).toBe('p2');
  });
  it('can plan move, strip and execute behind taking a knife',()=>{
    const g=fixture([{steps:4},{},{}]);
    for(const [type,target] of [['knife'],['move','p1'],['strip','p1'],['execute','p1']])expect(action(g,'p0',type,target).ok).toBe(true);
    g.update(3);expect(player(g)).toMatchObject({location:'p1',knife:true,active:{type:'strip'}});
    expect(player(g,1).armor).toBe(1);g.update(3);expect(player(g,1)).toMatchObject({armor:0,alive:true});
    expect(player(g).active.type).toBe('execute');g.update(3);expect(player(g,1).alive).toBe(false);expect(player(g).knife).toBe(true);
  });
  it('wear and knife can complete anywhere, armor stays within 0..3',()=>{
    const g=fixture([{steps:5,location:'p1'},{},{}]);action(g,'p0','wear');action(g,'p0','wear');
    expect(action(g,'p0','wear').ok).toBe(false);g.update(2);expect(player(g).armor).toBe(3);
    action(g,'p0','knife');g.update(1);expect(player(g).knife).toBe(true);
  });
  it('strip needs no knife, takes 3s and zero armor does not kill',()=>{
    const g=fixture([{steps:2},{location:'p0'},{}]);action(g,'p0','strip','p1');g.update(2.999);
    expect(player(g,1).armor).toBe(1);g.update(.001);expect(player(g,1)).toMatchObject({armor:0,alive:true});
    expect(action(g,'p0','strip','p1').ok).toBe(false);expect(action(g,'p0','execute','p1').ok).toBe(false);
  });
  it('settles a later-started wear before an execute at the exact same time',()=>{
    const g=fixture([{steps:1,knife:true},{steps:1,location:'p0',armor:0},{}]);
    action(g,'p0','execute','p1');g.update(2);action(g,'p1','wear');g.update(1);
    expect(player(g,1)).toMatchObject({alive:true,armor:1});expect(player(g).steps).toBe(0);
    expect(g.getState().logs.some(l=>l.text.includes('割无效'))).toBe(true);
  });
  it('uses the complete same-time priority regardless of submission order',()=>{
    const g=fixture([{steps:1,location:'p5'},{steps:1,knife:true,location:'p6'},{steps:1},{steps:1},{},{armor:1},{steps:1,armor:0}]);
    const completed=[];g.subscribe(e=>{if(e.type==='action_completed')completed.push(e.action);});
    action(g,'p1','execute','p6');action(g,'p0','strip','p5');g.update(1);
    action(g,'p2','move','p3');g.update(1);action(g,'p6','wear');action(g,'p3','knife');g.update(1);
    expect(completed).toEqual(['knife','move','wear','strip','execute']);expect(player(g,6).alive).toBe(true);
  });
  it('a moving target escapes a pending strip; failed action still spends its step',()=>{
    const g=fixture([{steps:1},{steps:1,location:'p0'},{}]);action(g,'p0','strip','p1');g.update(.5);action(g,'p1','move','p2');
    g.update(2.5);expect(player(g,1)).toMatchObject({location:'p2',armor:1,alive:true});expect(player(g).steps).toBe(0);
  });
  it('actors can be ambushed while locked; death cancels active and queued actions',()=>{
    const g=fixture([{steps:2,armor:0},{steps:1,knife:true,location:'p0'},{location:'p0'}]);
    action(g,'p1','execute','p0');g.update(1);action(g,'p0','strip','p2');action(g,'p0','wear');g.update(2);
    expect(player(g)).toMatchObject({alive:false,steps:0,active:null,queue:[]});g.update(2);expect(player(g,2).armor).toBe(1);
  });
  it('the round waits for in-flight and queued actions after all steps are assigned',()=>{
    const g=fixture([{steps:2},{steps:1},{}]);action(g,'p0','knife');action(g,'p0','move','p1');action(g,'p1','wear');
    expect(g.getState().phase).toBe('action');g.update(1);expect(g.getState().phase).toBe('action');g.update(2);
    expect(g.getState().phase).toBe('between');g.update(1.1);expect(g.getState().phase).toBe('rps');
    expect(player(g)).toMatchObject({steps:0,knife:true,location:'p1'});
  });
  it('large and small tick slices produce the same completion ordering and outcome',()=>{
    const run=(small)=>{const g=fixture([{steps:4},{},{}]);for(const [t,x] of [['knife'],['move','p1'],['strip','p1'],['execute','p1']])action(g,'p0',t,x);
      if(small)for(let i=0;i<900;i++)g.update(.01);else g.update(9);return g.getState();};
    const a=run(false),b=run(true);expect(a.players).toEqual(b.players);expect(a.logs.map(x=>x.text)).toEqual(b.logs.map(x=>x.text));
  });
  it('finishes a full match through legal commands and resets on restart',()=>{
    const g=game(2);
    for(const [type,target] of [['knife'],['move','p1'],['strip','p1'],['execute','p1']]){
      round(g,['rock','scissors']);expect(action(g,'p0',type,target).ok).toBe(true);g.update(ACTION_SECONDS[type]);g.update(1.1);
    }
    expect(g.getState()).toMatchObject({phase:'over',result:'p0'});expect(player(g,1).alive).toBe(false);
    g.start(['你','电脑']);expect(g.getState().players.every(p=>p.alive&&p.armor===1&&!p.knife&&!p.active&&!p.queue.length)).toBe(true);
  });
  it('pause freezes action time and the queue; resume needs remaining duration',()=>{
    const g=fixture([{steps:2},{}]);action(g,'p0','knife');action(g,'p0','wear');g.update(.5);g.invoke({type:'pause'});g.update(10);
    expect(player(g).knife).toBe(false);expect(g.getState().time).toBe(.5);g.invoke({type:'pause'});g.update(.5);
    expect(player(g)).toMatchObject({knife:true,armor:1,active:{type:'wear'}});g.update(1);expect(player(g).armor).toBe(2);
  });
  it('snapshots cannot mutate rules and invalid dt is rejected',()=>{
    const g=game();g.getState().players[0].armor=999;expect(player(g).armor).toBe(1);expect(()=>g.update(NaN)).toThrow();
  });
  it('bots use the same delayed actions and do not finish a knife immediately',()=>{
    const g=fixture([{steps:1},{steps:3}]);const bot=new BotController(g,()=>0);bot.update();g.update(.4);bot.update();
    expect(player(g,1)).toMatchObject({knife:false,steps:2,active:{type:'knife'}});bot.update();expect(player(g,1).steps).toBe(2);
    g.update(1);expect(player(g,1).knife).toBe(true);bot.update();expect(player(g,1).active.type).toBe('move');
  });
});
