// Simple Hydro flows for testing (non-DFIR version)
use hydro_lang::prelude::*;

#[hydro::flow]
pub fn simple_flow<'a>(flow: &FlowBuilder<'a>) -> Process<'a, ()> {
    let process = flow.process();
    
    process
        .source_iter(q!(vec![1, 2, 3]))
        .map(q!(|x| x * 2))
        .for_each(q!(|x| println!("{}", x)));
    
    process
}