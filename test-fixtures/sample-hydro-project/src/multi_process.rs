// Multi-process Hydro flows for testing (non-DFIR version)
use hydro_lang::prelude::*;

#[hydro::flow]
pub fn multi_process_flow<'a>(flow: &FlowBuilder<'a>) -> (Process<'a, ()>, Process<'a, ()>) {
    let process1 = flow.process();
    let process2 = flow.process();
    
    let data = process1
        .source_iter(q!(vec!["hello", "world"]))
        .map(q!(|s| s.to_uppercase()));
    
    data.send_bincode(&process2)
        .for_each(q!(|msg| println!("Process2 received: {}", msg)));
    
    (process1, process2)
}

pub fn another_hydro_function<'a>(flow: &FlowBuilder<'a>) -> Process<'a, ()> {
    let process = flow.process();
    
    process
        .source_iter(q!(vec![10, 20, 30]))
        .inspect(q!(|&x| println!("Processing: {}", x)))
        .for_each(q!(|x| println!("Result: {}", x)));
    
    process
}